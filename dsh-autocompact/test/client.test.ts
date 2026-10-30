/**
 * Client-half tests against the real browser plane.
 *
 * The built `client.js` is evaluated by a real jsdom window through the page's
 * own `window.__ModuleLoader__.load({ id, factory })` contract; `factory`
 * receives the real `react` / `react/jsx-runtime` modules the page's module
 * table provides. Rendering uses React's real renderer over the real components
 * the artifact registers. There is no `runInNewContext` shim, no
 * `ComponentStub`, and no fake `createElement`: the module and its components
 * are the packaged artifact.
 *
 * The Cordis context is real (`new Context()` from `@deepseek-ai/cordis`); the
 * client services this package injects are provided through `ctx.provide()`.
 * Those client services (`slots`, `locale`, and the Remote namespaces) are not
 * part of this package's pinned dev closure — no `dsh-client-ui-*` host package
 * beyond the primitives is installed — so the fixtures below implement their
 * documented public faces. The primitives package itself is not imported by this
 * package's client half, so no primitives component is replaced or stubbed.
 */
import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { ClientContext, Translate } from "../src/client/contracts.ts";
import { createBrowserWindow } from "./jsdom-types.ts";

interface ClientPlugin {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

interface SectionRegistration {
  readonly slot: string;
  readonly options: Record<string, unknown>;
  readonly Component: (props: Record<string, unknown>) => React.ReactElement;
}

interface DescribeView {
  readonly ns: string;
  readonly revision: number;
  readonly value: Record<string, unknown>;
}

interface RemoteResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

interface RegisteredModule {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => ClientPlugin;
}

/** The one module registration, captured by the real jsdom window contract. */
let registered: RegisteredModule | undefined;
let moduleIds: string[] = [];

beforeAll(() => {
  const window = createBrowserWindow();
  window.__ModuleLoader__ = {
    load(registration: RegisteredModule) {
      registered = registration;
    },
  };
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  // The artifact is the page's script: jsdom evaluates it with a real window.
  window.eval(source);
});

/** Load the browser half through the module table the page implements. */
function loadClientPlugin(): ClientPlugin {
  if (registered === undefined) throw new Error("client.js did not register a module");
  expect(registered.id).toBe("@indexyz/dsh-autocompact");
  moduleIds = [];
  return registered.factory((id) => {
    moduleIds.push(id);
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`unexpected module request: ${id}`);
  });
}

/** The English string registered by the client half itself. */
function translate(key: string, params?: Readonly<Record<string, string | number>>): string {
  const dictionary = registeredDictionary();
  const template = dictionary[key] ?? key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

let boundDictionary: Record<string, string> = {};
function registeredDictionary(): Record<string, string> {
  return boundDictionary;
}

interface HarnessOptions {
  readonly ns?: string;
  readonly view?: DescribeView;
  readonly writable?: boolean;
  readonly describeFails?: string;
  readonly catalog?: unknown;
  readonly session?: boolean;
  readonly layout?: boolean;
  readonly settingsShell?: "pinned" | "unpinned" | "absent";
  readonly projections?: Record<string, unknown>;
  /** Throw from one dictionary key, to exercise the section's crash face. */
  readonly failKey?: string;
}

function createHarness(options: HarnessOptions = {}) {
  const sections: SectionRegistration[] = [];
  const describeCalls: unknown[][] = [];
  const updateCalls: unknown[][] = [];
  const mutateCalls: unknown[][] = [];
  const catalogCalls: unknown[][] = [];
  const selectPanelCalls: string[] = [];
  const openSectionCalls: string[] = [];

  const describe = async (): Promise<
    RemoteResult<{ namespaces: DescribeView[]; writable: boolean }>
  > => {
    describeCalls.push([]);
    if (options.describeFails !== undefined) {
      return { ok: false, error: { code: "settings/rejected", message: options.describeFails } };
    }
    const view = options.view ?? {
      ns: options.ns ?? "autocompact",
      revision: 4,
      value: { enabled: true, modelLimits: { "provider/model": 300000 } },
    };
    return { ok: true, value: { namespaces: [view], writable: options.writable ?? true } };
  };
  const update = async (
    ns: string,
    patch: Record<string, unknown>,
    revision?: number,
  ): Promise<RemoteResult<DescribeView>> => {
    updateCalls.push([ns, patch, revision]);
    return {
      ok: true,
      value: { ns: "autocompact", revision: 5, value: { enabled: false, modelLimits: {} } },
    };
  };
  const mutate = async (
    ns: string,
    ops: readonly unknown[],
    revision?: number,
  ): Promise<RemoteResult<DescribeView>> => {
    mutateCalls.push([ns, ops, revision]);
    return {
      ok: true,
      value: {
        ns: "autocompact",
        revision: 6,
        value: { enabled: true, modelLimits: { "provider/model": 400000 } },
      },
    };
  };
  const modelCatalog = async (): Promise<{ ok: boolean; value: unknown }> => {
    catalogCalls.push([]);
    return {
      ok: true,
      value: options.catalog ?? {
        groups: [{ id: "provider", name: "Provider", models: [{ id: "model", name: "Model" }] }],
      },
    };
  };

  const liveShell = {
    actions: {
      openSection: (section: string) => {
        openSectionCalls.push(section);
      },
    },
  };
  const settingsShellEntries = () =>
    options.settingsShell === "pinned"
      ? [
          {
            store: {
              spec: { actions: { openSection: (draft: unknown, section: string) => section } },
              create: () => liveShell,
            },
          },
        ]
      : options.settingsShell === "unpinned"
        ? [{ store: { spec: { actions: {} }, create: () => ({ actions: {} }) } }]
        : [];

  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());

  let currentSlot = "";
  const slots = {
    entries: (slot: string) => (slot === "sidebar.settings" ? settingsShellEntries() : undefined),
    inject: (key: string, callback: () => unknown) => {
      currentSlot = key;
      try {
        return callback();
      } finally {
        currentSlot = "";
      }
    },
    register: (
      registrationOptions: Record<string, unknown>,
      Component: SectionRegistration["Component"],
    ) => {
      sections.push({ slot: currentSlot, options: registrationOptions, Component });
      return () => {};
    },
  };
  const locale = {
    register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => {
      expect(namespace).toBe("autocompact");
      boundDictionary = dictionaries["en"] ?? {};
      return () => {
        boundDictionary = {};
      };
    },
    bind: (namespace: string): Translate => {
      expect(namespace).toBe("autocompact");
      return (key, params) => {
        if (options.failKey === key) throw new Error(`boom-in-${key}`);
        return translate(key, params);
      };
    },
  };

  ctx.provide("slots", slots);
  ctx.provide("locale", locale);
  ctx.provide("remote.settings", { describe, update, mutate });
  ctx.provide("layout", {
    selectPanel: (panelId: string) => {
      selectPanelCalls.push(panelId);
    },
  });
  if (options.session !== false) ctx.provide("remote.session", { modelCatalog });

  return {
    ctx,
    sections,
    describeCalls,
    updateCalls,
    mutateCalls,
    catalogCalls,
    selectPanelCalls,
    openSectionCalls,
  };
}

async function render(
  Component: SectionRegistration["Component"],
  props: Record<string, unknown> = { close: () => {} },
): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(React.createElement(Component, props as never));
  });
  return tree!;
}

/** The one registration made in a slot. */
function registrationIn(harness: { sections: SectionRegistration[] }, slot: string) {
  const registration = harness.sections.find((section) => section.slot === slot);
  if (registration === undefined) throw new Error(`nothing registered in ${slot}`);
  return registration;
}

function findByLabel(tree: ReactTestRenderer, type: string, label: string) {
  return tree.root.findAll((node) => node.type === type && node.props["aria-label"] === label, {
    deep: true,
  })[0];
}

function byClass(tree: ReactTestRenderer, className: string) {
  return tree.root.findAll((node) => node.props.className === className, { deep: true });
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe("settings page", () => {
  it("registers one Autocompact section in the settings navigation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    expect(moduleIds).toEqual(["react", "react/jsx-runtime"]);
    // The page writes through the `remote.settings` namespace service, which a
    // context only reaches when it declares that service in `inject`.
    expect(plugin.inject).toEqual(["slots", "locale", "remote.settings"]);
    expect(harness.sections.map((section) => section.slot)).toEqual([
      "settings.section",
      "main",
      "conversation.composer.dock",
    ]);
    expect(harness.sections[1]!.options).toMatchObject({ name: "main", key: "autocompact" });
    const options = harness.sections[0]!.options;
    expect(options).toMatchObject({
      name: "settings.section",
      id: "autocompact",
      order: 25,
      locale: "autocompact",
    });
    expect((options.label as () => string)()).toBe("Autocompact");
    expect(harness.sections[2]!.options).toMatchObject({
      name: "conversation.composer.dock",
      id: "autocompact",
      order: 10,
    });
  });

  it("renders the same editor in the panel the status pill opens", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(registrationIn(harness, "main").Component);
    expect(textOf(tree)).toContain("Per-model thresholds");
    expect(findByLabel(tree, "input", "provider/model Threshold")).toBeDefined();
  });

  it("renders the configured thresholds and the model picker", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    expect(harness.describeCalls).toHaveLength(1);
    expect(harness.catalogCalls).toHaveLength(1);
    const html = textOf(tree);
    expect(html).toContain("provider/model");
    expect(html).toContain("300K");
    expect(html).toContain("Provider");
    expect(findByLabel(tree, "button", "Use automatic thresholds")?.props["aria-checked"]).toBe(
      "true",
    );
  });

  it("writes an edited threshold through the settings Remote with the read revision", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);

    const input = findByLabel(tree, "input", "provider/model Threshold");
    await act(async () => {
      input!.props.onChange({ target: { value: "400K" } });
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toEqual([
      ["autocompact", [{ op: "set", path: ["modelLimits", "provider/model"], value: 400000 }], 4],
    ]);
    expect(textOf(tree)).toContain("Saved.");
  });

  it("unwinds a removed threshold as an unset path operation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-danger")[0]!.props.onClick();
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toEqual([
      ["autocompact", [{ op: "unset", path: ["modelLimits", "provider/model"] }], 4],
    ]);
  });

  it("toggles the master switch through the update face", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    await act(async () => {
      findByLabel(tree, "button", "Use automatic thresholds")!.props.onClick();
    });
    expect(harness.updateCalls).toEqual([["autocompact", { enabled: false }, 4]]);
  });

  it("rejects an unparsable threshold instead of writing it", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    await act(async () => {
      findByLabel(tree, "input", "provider/model Threshold")!.props.onChange({
        target: { value: "banana" },
      });
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toHaveLength(0);
    expect(textOf(tree)).toContain("Use a positive count");
  });

  it("explains a deployment whose autocompact row is not configurable", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "something-else", revision: 1, value: {} },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("No autocompact row in this profile");
  });

  it("marks a read-only profile without offering write controls", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ writable: false });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("Read-only profile");
    expect(findByLabel(tree, "button", "Use automatic thresholds")?.props.disabled).toBe(true);
    expect(findByLabel(tree, "input", "Default threshold")?.props.disabled).toBe(true);
  });

  it("matches the row when the entry id is namespaced", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "include:autocompact", revision: 9, value: { modelLimits: {} } },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("No thresholds yet.");
    expect(textOf(tree)).not.toContain("No autocompact row");
    await act(async () => {
      findByLabel(tree, "button", "Use automatic thresholds")!.props.onClick();
    });
    expect(harness.updateCalls).toEqual([["include:autocompact", { enabled: false }, 9]]);
  });

  it("keeps a render crash on the page instead of leaving the section blank", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ failKey: "intro" });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    const html = textOf(tree);
    expect(html).toContain("boom-in-intro");
    expect(html).toContain("This page failed to render");
  });

  it("falls back to manual route entry when no model catalog is mounted", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ session: false });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    expect(harness.catalogCalls).toHaveLength(0);
    expect(findByLabel(tree, "input", "Route (provider/model)")).toBeDefined();
  });

  it("edits the deployment default threshold above the model list", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "autocompact", revision: 4, value: { enabled: true, modelLimits: {} } },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    const input = findByLabel(tree, "input", "Default threshold");
    expect(input).toBeDefined();
    await act(async () => {
      input!.props.onChange({ target: { value: "300k" } });
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toEqual([
      ["autocompact", [{ op: "set", path: ["defaultLimit"], value: 300000 }], 4],
    ]);
  });

  it("clears a persisted deployment default as an unset operation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 5,
        value: { enabled: true, modelLimits: {}, defaultLimit: 300000 },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    const input = findByLabel(tree, "input", "Default threshold");
    expect(input!.props.value).toBe("300000");
    await act(async () => {
      input!.props.onChange({ target: { value: "" } });
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toEqual([
      ["autocompact", [{ op: "unset", path: ["defaultLimit"] }], 5],
    ]);
  });

  it("rejects an unparsable deployment default instead of writing it", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 6,
        value: { enabled: true, modelLimits: {}, defaultLimit: 300000 },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await render(harness.sections[0]!.Component);
    await act(async () => {
      findByLabel(tree, "input", "Default threshold")!.props.onChange({
        target: { value: "banana" },
      });
    });
    await act(async () => {
      byClass(tree, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });
    expect(harness.mutateCalls).toHaveLength(0);
    expect(textOf(tree)).toContain("Use a positive count");
  });
});

describe("composer status line", () => {
  async function renderDock(
    harness: ReturnType<typeof createHarness>,
    values: Record<string, unknown> = {},
  ) {
    const registration = registrationIn(harness, "conversation.composer.dock");
    return await render(registration.Component, {
      session: {},
      input: {},
      useProjection: (key: string) => values[key],
    });
  }

  function dockElement(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => typeof node.type === "string" && node.props.className === "dsha-status",
      { deep: true },
    )[0];
  }

  it("reads the session route and shows the pressure against the threshold", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ settingsShell: "pinned" });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      contextPressure: { pressureTokens: 120000, projectedTokens: 128000 },
    });

    expect(harness.describeCalls.length).toBeGreaterThan(0);
    const dock = dockElement(tree)!;
    expect(dock.props["data-state"]).toBe("on");
    expect(dock.findByType("svg")).toBeDefined();
    expect(dock.type).toBe("button");
    await act(async () => {
      dock.props.onClick();
    });
    expect(harness.openSectionCalls).toEqual(["autocompact"]);
    expect(harness.selectPanelCalls).toHaveLength(0);
    expect(textOf(tree)).toContain("128K / 300K");
    expect(dock.props["title"]).toBe("provider/model: 128K of 300K\nClick to open settings");
    expect(dock.props["aria-label"]).toBe(dock.props["title"]);
    // The pill carries no word of the plugin's name.
    expect(textOf(tree)).not.toContain("Autocompact");
  });

  it("falls back to the last used route when no selection is pending", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: { provider: "provider", model: "model" }, next: null },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("on");
    expect(textOf(tree)).toContain("300K");
    expect(dockElement(tree)!.props["title"]).toContain("compact above 300K");
  });

  it("shows the deployment default for a model without its own threshold", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 1,
        value: { enabled: true, modelLimits: {}, defaultLimit: 300000 },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      contextPressure: { pressureTokens: 120000, projectedTokens: 128000 },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("on");
    expect(textOf(tree)).toContain("128K / 300K");
  });

  it("shows a per-model threshold instead of the deployment default", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 2,
        value: {
          enabled: true,
          modelLimits: { "provider/model": 400000 },
          defaultLimit: 300000,
        },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(textOf(tree)).toContain("400K");
    expect(textOf(tree)).not.toContain("300K");
  });

  it("reports the off switch even when a deployment default is configured", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 3,
        value: { enabled: false, modelLimits: {}, defaultLimit: 300000 },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("off");
  });

  it("writes counts in the k and m units the grammar takes", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 1,
        value: {
          enabled: true,
          modelLimits: { "provider/model": 999999, "other/route": 1234 },
        },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);

    const big = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(textOf(big)).toContain("1M");
    expect(textOf(big)).not.toContain("1000K");

    const small = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "other", model: "route" } },
    });
    expect(textOf(small)).toContain("1.2K");
  });

  it("sends the user to its own panel when the settings shell is not reachable", async () => {
    const plugin = await loadClientPlugin();
    for (const settingsShell of ["absent", "unpinned"] as const) {
      const harness = createHarness({ settingsShell });
      plugin.apply(harness.ctx as unknown as ClientContext);
      const tree = await renderDock(harness, {
        modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      });
      await act(async () => {
        dockElement(tree)!.props.onClick();
      });
      expect(harness.openSectionCalls).toHaveLength(0);
      expect(harness.selectPanelCalls).toEqual(["autocompact"]);
    }
  });

  it("keeps the reading when a composition has no panel navigation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ layout: false });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    const dock = dockElement(tree)!;
    await act(async () => {
      expect(() => dock.props.onClick()).not.toThrow();
    });
    expect(textOf(tree)).toContain("300K");
  });

  it("takes no seat in the ambient row for a model without a threshold", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "other", model: "route" } },
    });
    expect(dockElement(tree)).toBeUndefined();
  });

  it("still reports a master switch that turned every threshold off", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "autocompact", revision: 2, value: { enabled: false, modelLimits: {} } },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: null },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("off");
    expect(textOf(tree)).toContain("Off");
  });

  it("reports the master switch as off, even while a threshold is configured", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: {
        ns: "autocompact",
        revision: 3,
        value: { enabled: false, modelLimits: { "provider/model": 300000 } },
      },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      contextPressure: { pressureTokens: 120000 },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("off");
    const html = textOf(tree);
    expect(html).toContain("Off");
    expect(html).toContain("Thresholds are off");
    expect(html).not.toContain("120K of");
  });

  it("stays out of the way when the deployment exposes no autocompact row", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "something-else", revision: 1, value: {} },
    });
    plugin.apply(harness.ctx as unknown as ClientContext);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(dockElement(tree)).toBeUndefined();
  });

  it("renders nothing when the projection hook throws, keeping the composer intact", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const registration = registrationIn(harness, "conversation.composer.dock");
    const tree = await render(registration.Component, {
      useProjection: () => {
        throw new Error("projection-store exploded");
      },
    });
    expect(dockElement(tree)).toBeUndefined();
  });

  it("follows a save made on the settings page", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness();
    plugin.apply(harness.ctx as unknown as ClientContext);
    const dock = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(textOf(dock)).toContain("300K");

    const page = await render(registrationIn(harness, "settings.section").Component);
    await act(async () => {
      findByLabel(page, "input", "provider/model Threshold")!.props.onChange({
        target: { value: "500k" },
      });
    });
    await act(async () => {
      byClass(page, "dsha-button dsha-button-primary")[0]!.props.onClick();
    });

    expect(harness.mutateCalls).toHaveLength(1);
    expect(textOf(dock)).toContain("400K");
  });
});
