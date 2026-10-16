import { beforeAll, describe, expect, it, vi } from "vitest";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

interface ClientPlugin {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

interface SectionRegistration {
  /** The slot the registration was made in. */
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

/** The one module registration, captured the way the page's loader captures it. */
let registered: RegisteredModule | undefined;

beforeAll(async () => {
  vi.stubGlobal("window", {
    __ModuleLoader__: {
      load(spec: RegisteredModule) {
        registered = spec;
      },
    },
  });
  await import("../client.js");
});

/** Load the browser half the way the page's module loader does. */
async function loadClientPlugin(): Promise<ClientPlugin> {
  if (registered === undefined) throw new Error("client.js did not register a module");
  expect(registered.id).toBe("@indexyz/dsh-autocompact");
  return registered.factory((id) => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`unexpected module request: ${id}`);
  });
}

/**
 * Interpolate `{name}` params, then surface the values the way a real
 * dictionary would. The stub keys carry no placeholders, so the param values are
 * appended: a test can then assert on the numbers and routes a user would see.
 */
function translate(key: string, params?: Record<string, unknown>): string {
  if (params === undefined) return key;
  return `${key} ${Object.values(params)
    .map((value) => String(value))
    .join(" ")}`;
}

function createHarness(options: {
  ns?: string;
  view?: DescribeView;
  writable?: boolean;
  describeFails?: string;
  catalog?: unknown;
  /** When false the `remote.session` namespace is not mounted at all. */
  session?: boolean;
  /** Replace the locale translate function, e.g. to make one key throw. */
  t?: (key: string, params?: Record<string, unknown>) => string;
  /** When false the client `layout` service is not mounted at all. */
  layout?: boolean;
  /**
   * Entries of the settings shell's cell. Absent means the shell is not reachable,
   * so the pill has to fall back to this plugin's own panel.
   */
  settingsShell?: "pinned" | "unpinned" | "absent";
  /** Values the slot kit's `useProjection` answers with, by projection key. */
  projections?: Record<string, unknown>;
}) {
  const sections: SectionRegistration[] = [];
  const describe = vi.fn<
    () => Promise<RemoteResult<{ namespaces: DescribeView[]; writable: boolean }>>
  >(async () => {
    if (options.describeFails !== undefined) {
      return { ok: false, error: { code: "settings/rejected", message: options.describeFails } };
    }
    const view = options.view ?? {
      ns: options.ns ?? "autocompact",
      revision: 4,
      value: { enabled: true, modelLimits: { "provider/model": 300000 } },
    };
    return { ok: true, value: { namespaces: [view], writable: options.writable ?? true } };
  });
  const update = vi.fn<() => Promise<RemoteResult<DescribeView>>>(async () => ({
    ok: true,
    value: { ns: "autocompact", revision: 5, value: { enabled: false, modelLimits: {} } },
  }));
  const mutate = vi.fn<() => Promise<RemoteResult<DescribeView>>>(async () => ({
    ok: true,
    value: {
      ns: "autocompact",
      revision: 6,
      value: { enabled: true, modelLimits: { "provider/model": 400000 } },
    },
  }));
  const modelCatalog = vi.fn<() => Promise<{ ok: boolean; value: unknown }>>(async () => ({
    ok: true,
    value: options.catalog ?? {
      groups: [{ id: "provider", name: "Provider", models: [{ id: "model", name: "Model" }] }],
    },
  }));
  const selectPanel = vi.fn<(panelId: string) => void>();
  const openSection = vi.fn<(section: string) => void>();
  // What `sidebar.settings` holds: the settings shell's store seat. The shell pins
  // its handle to the live instance; another store's handle mints a fresh one that
  // the panel never sees.
  const liveShell = { actions: { openSection } };
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
  const ctx = {
    effect: (execute: () => unknown) => execute(),
    // Remote namespaces are their own Cordis services (`remote.<ns>`), and the
    // context proxy throws for any property that is not a declared service — so
    // the stub resolves service keys only, exactly like the real `ctx.get`.
    get: (name: string) => {
      if (name === "remote.settings") return { describe, update, mutate };
      if (name === "remote.session")
        return options.session === false ? undefined : { modelCatalog };
      if (name === "layout") return options.layout === false ? undefined : { selectPanel };
      if (name === "slots") return { entries: settingsShellEntries };
      return undefined;
    },
    locale: {
      register: vi.fn<() => () => void>(() => () => {}),
      bind: () => options.t ?? translate,
    },
    slots: {
      inject: (key: string, callback: () => unknown) => {
        currentSlot = key;
        try {
          return callback();
        } finally {
          currentSlot = "";
        }
      },
      register: (
        regOptions: Record<string, unknown>,
        Component: SectionRegistration["Component"],
      ) => {
        sections.push({ slot: currentSlot, options: regOptions, Component });
        return () => {};
      },
    },
  };
  return { ctx, sections, describe, update, mutate, modelCatalog, selectPanel, openSection };
}

/** The slot an `inject`/`register` pair is currently running in. */
let currentSlot = "";

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
  const nodes = tree.root.findAll(
    (node) => node.type === type && node.props["aria-label"] === label,
    { deep: true },
  );
  return nodes[0];
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe("settings page", () => {
  it("registers one Autocompact section in the settings navigation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    // The page writes through the `remote.settings` namespace service, which a
    // context only reaches when it declares that service in `inject`.
    expect(plugin.inject).toEqual(["slots", "locale", "remote.settings"]);
    // One Settings page, the central panel the pill selects, and one status line.
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
    expect((options.label as () => string)()).toBe("nav");
    expect(harness.sections[2]!.options).toMatchObject({
      name: "conversation.composer.dock",
      id: "autocompact",
      order: 10,
    });
  });

  it("renders the same editor in the panel the status pill opens", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(registrationIn(harness, "main").Component);
    // The panel is the settings page's own editor, so a threshold set here and
    // one set in Settings cannot drift apart.
    expect(textOf(tree)).toContain("models");
    expect(findByLabel(tree, "input", "provider/model threshold")).toBeDefined();
  });

  it("renders the configured thresholds and the model picker", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    expect(harness.describe).toHaveBeenCalledOnce();
    expect(harness.modelCatalog).toHaveBeenCalledOnce();
    const html = textOf(tree);
    expect(html).toContain("provider/model");
    expect(html).toContain("300K");
    expect(html).toContain("Provider");
    expect(findByLabel(tree, "button", "enabled")?.props["aria-checked"]).toBe("true");
  });

  it("writes an edited threshold through the settings Remote with the read revision", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);

    const input = findByLabel(tree, "input", "provider/model threshold");
    await act(async () => {
      input.props.onChange({ target: { value: "400K" } });
    });
    const save = tree.root.findAll(
      (node) =>
        node.type === "button" && node.props.className === "dsha-button dsha-button-primary",
    )[0];
    await act(async () => {
      save!.props.onClick();
    });
    expect(harness.mutate).toHaveBeenCalledWith(
      "autocompact",
      [{ op: "set", path: ["modelLimits", "provider/model"], value: 400000 }],
      4,
    );
    expect(textOf(tree)).toContain("saved");
  });

  it("unwinds a removed threshold as an unset path operation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);

    const remove = tree.root.findAll(
      (node) => node.type === "button" && node.props.className === "dsha-button dsha-button-danger",
    )[0];
    await act(async () => {
      remove!.props.onClick();
    });
    const save = tree.root.findAll(
      (node) =>
        node.type === "button" && node.props.className === "dsha-button dsha-button-primary",
    )[0];
    await act(async () => {
      save!.props.onClick();
    });
    expect(harness.mutate).toHaveBeenCalledWith(
      "autocompact",
      [{ op: "unset", path: ["modelLimits", "provider/model"] }],
      4,
    );
  });

  it("toggles the master switch through the update face", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    const toggle = findByLabel(tree, "button", "enabled");
    await act(async () => {
      toggle!.props.onClick();
    });
    expect(harness.update).toHaveBeenCalledWith("autocompact", { enabled: false }, 4);
  });

  it("rejects an unparsable threshold instead of writing it", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    const input = findByLabel(tree, "input", "provider/model threshold");
    await act(async () => {
      input.props.onChange({ target: { value: "banana" } });
    });
    const save = tree.root.findAll(
      (node) =>
        node.type === "button" && node.props.className === "dsha-button dsha-button-primary",
    )[0];
    await act(async () => {
      save!.props.onClick();
    });
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain("invalid");
  });

  it("explains a deployment whose autocompact row is not configurable", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ view: { ns: "something-else", revision: 1, value: {} } });
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("unavailable");
  });

  it("marks a read-only profile without offering write controls", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ writable: false });
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("readOnly");
    expect(findByLabel(tree, "button", "enabled")?.props.disabled).toBe(true);
  });

  it("matches the row when the entry id is namespaced", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "include:autocompact", revision: 9, value: { modelLimits: {} } },
    });
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    expect(textOf(tree)).toContain("empty");
    expect(textOf(tree)).not.toContain("unavailable");

    // Writes address the namespace the Host reported, not this plugin's own name.
    const toggle = findByLabel(tree, "button", "enabled");
    await act(async () => {
      toggle!.props.onClick();
    });
    expect(harness.update).toHaveBeenCalledWith("include:autocompact", { enabled: false }, 9);
  });

  it("keeps a render crash on the page instead of leaving the section blank", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      t: (key, params) => {
        if (key === "intro") throw new Error("boom-in-intro");
        return translate(key, params);
      },
    });
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    const html = textOf(tree);
    expect(html).toContain("boom-in-intro");
    expect(html).toContain("crash");
  });

  it("falls back to manual route entry when no model catalog is mounted", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ session: false });
    plugin.apply(harness.ctx);
    const tree = await render(harness.sections[0]!.Component);
    expect(harness.modelCatalog).not.toHaveBeenCalled();
    expect(findByLabel(tree, "input", "manual")).toBeDefined();
  });
});

describe("composer status line", () => {
  /** Mount the dock entry with a kit whose projection reader answers from `values`. */
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

  /** The dock's own element, or `undefined` when it rendered nothing. */
  function dockElement(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => typeof node.type === "string" && node.props.className === "dsha-status",
      { deep: true },
    )[0];
  }

  it("reads the session route and shows the pressure against the threshold", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ settingsShell: "pinned" });
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      contextPressure: { pressureTokens: 120000, projectedTokens: 128000 },
    });

    // `provider/model` is exactly the configured key, so the pill reports it.
    expect(harness.describe).toHaveBeenCalled();
    const dock = dockElement(tree)!;
    expect(dock.props["data-state"]).toBe("on");
    // The icon carries the identity and takes the pill's colour with it.
    expect(dock.findByType("svg")).toBeDefined();
    // Acting on the reading opens Settings on this plugin's section, through the
    // settings shell's own store: `openSection` is what its panel renders from.
    expect(dock.type).toBe("button");
    await act(async () => {
      dock.props.onClick();
    });
    expect(harness.openSection).toHaveBeenCalledWith("autocompact");
    // The plugin's own panel is the fallback, not the destination.
    expect(harness.selectPanel).not.toHaveBeenCalled();
    // The host writes this pair as `used / capacity`; the pressure comes first.
    expect(textOf(tree)).toContain("128K / 300K");
    // The reading is the whole text: the pill carries no word of the plugin name,
    // and the meaning lives in the tooltip.
    expect(textOf(tree)).not.toContain("nav");
    expect(textOf(tree)).not.toContain("dockDefault");
    expect(dock.props["title"]).toContain("dockTitleLimitNow");
    expect(dock.props["aria-label"]).toBe(dock.props["title"]);
  });

  it("falls back to the last used route when no selection is pending", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: { provider: "provider", model: "model" }, next: null },
    });
    // No usage sample yet: the threshold stands alone.
    expect(dockElement(tree)!.props["data-state"]).toBe("on");
    expect(textOf(tree)).toContain("300K");
    expect(dockElement(tree)!.props["title"]).toContain("dockTitleLimit");
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
    plugin.apply(harness.ctx);

    // Rounding picks the unit, so the boundary reads as `1M`, never `1000K`.
    const big = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(textOf(big)).toContain("1M");
    expect(textOf(big)).not.toContain("1000K");

    // One decimal is enough to read a threshold that is not a round number.
    const small = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "other", model: "route" } },
    });
    expect(textOf(small)).toContain("1.2K");
  });

  it("sends the user to its own panel when the settings shell is not reachable", async () => {
    const plugin = await loadClientPlugin();
    for (const settingsShell of ["absent", "unpinned"] as const) {
      // A store whose handle is not pinned mints a fresh instance the panel never
      // renders from, so asking it would change nothing on screen.
      const harness = createHarness({ settingsShell });
      plugin.apply(harness.ctx);
      const tree = await renderDock(harness, {
        modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      });
      await act(async () => {
        dockElement(tree)!.props.onClick();
      });
      expect(harness.openSection).not.toHaveBeenCalled();
      expect(harness.selectPanel).toHaveBeenCalledWith("autocompact");
    }
  });

  it("keeps the reading when a composition has no panel navigation", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ layout: false });
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    const dock = dockElement(tree)!;
    await act(async () => {
      // No `layout` service: the click must be inert, not a crash.
      expect(() => dock.props.onClick()).not.toThrow();
    });
    expect(textOf(tree)).toContain("300K");
  });

  it("takes no seat in the ambient row for a model without a threshold", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "other", model: "route" } },
    });
    // "Not configured for this model" says nothing: no threshold is configured
    // for the route and none is in force, so the line stays out of the session's
    // own readings instead of announcing a non-event.
    expect(dockElement(tree)).toBeUndefined();
    expect(textOf(tree)).not.toContain("dockDefault");
  });

  it("still reports a master switch that turned every threshold off", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({
      view: { ns: "autocompact", revision: 2, value: { enabled: false, modelLimits: {} } },
    });
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      // Even before a route is resolved: an off switch is true of this session
      // whatever model it ends up using, and it was a deliberate choice.
      modelSelection: { lastUsed: null, next: null },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("off");
    expect(textOf(tree)).toContain("dockOff");
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
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
      contextPressure: { pressureTokens: 120000 },
    });
    expect(dockElement(tree)!.props["data-state"]).toBe("off");
    const html = textOf(tree);
    expect(html).toContain("dockOff");
    expect(html).toContain("dockTitleOff");
    // No pressure reading is offered while the automatic check is off.
    expect(html).not.toContain("dockNow");
  });

  it("stays out of the way when the deployment exposes no autocompact row", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({ view: { ns: "something-else", revision: 1, value: {} } });
    plugin.apply(harness.ctx);
    const tree = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(dockElement(tree)).toBeUndefined();
  });

  it("renders nothing when the projection hook throws, keeping the composer intact", async () => {
    const plugin = await loadClientPlugin();
    const harness = createHarness({});
    plugin.apply(harness.ctx);
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
    const harness = createHarness({});
    plugin.apply(harness.ctx);
    // The status line is already on screen when the user opens Settings…
    const dock = await renderDock(harness, {
      modelSelection: { lastUsed: null, next: { provider: "provider", model: "model" } },
    });
    expect(textOf(dock)).toContain("300K");

    // …edits the row and saves it; the page hands the written view to the store.
    const page = await render(registrationIn(harness, "settings.section").Component);
    const input = findByLabel(page, "input", "provider/model threshold");
    await act(async () => {
      input!.props.onChange({ target: { value: "500k" } });
    });
    await act(async () => {
      page.root
        .findAll((node) => node.props.className === "dsha-button dsha-button-primary", {
          deep: true,
        })[0]!
        .props.onClick();
    });

    // The write answered 400K for that route, and the line follows it live.
    expect(harness.mutate).toHaveBeenCalled();
    expect(textOf(dock)).toContain("400K");
  });
});
