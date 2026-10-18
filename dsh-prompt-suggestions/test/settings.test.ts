import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientContext, SettingsFace } from "../src/client/contracts.ts";
import { NS } from "../src/client/contracts.ts";
import { bindClientContext } from "../src/client/context.ts";
import { DICT } from "../src/client/dictionary.ts";
import { enabledSnapshot, setEnabled } from "../src/client/enabled.ts";
import { SettingsItem } from "../src/client/settings.tsx";

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
  Switch: ({
    checked,
    onChange,
    label,
    disabled,
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
    label: string;
    disabled?: boolean;
  }) =>
    React.createElement("button", {
      type: "button",
      role: "switch",
      "aria-label": label,
      "aria-checked": checked,
      disabled,
      onClick: () => onChange(!checked),
    }),
}));

const t = (key: string): string => DICT.en[key as keyof typeof DICT.en] ?? key;
const renderers: ReactTestRenderer[] = [];

function namespace(enabled = true, revision = 3) {
  return { ns: NS, revision, value: { enabled } };
}

function describeValue(enabled = true, revision = 3, writable = true) {
  return { ok: true as const, value: { writable, namespaces: [namespace(enabled, revision)] } };
}

async function mount(options: {
  describe?: () => Promise<unknown>;
  update?: (...args: unknown[]) => Promise<unknown>;
  missingSettings?: boolean;
}) {
  const describe = vi.fn<() => Promise<unknown>>(options.describe ?? (async () => describeValue()));
  const update = vi.fn<(...args: unknown[]) => Promise<unknown>>(
    options.update ??
      (async (_ns: unknown, patch: unknown) => ({
        ok: true,
        value: { ...namespace(), revision: 4, value: patch },
      })),
  );
  const ctx = {
    get(service: string): unknown {
      if (service === "remote.settings") {
        return options.missingSettings
          ? undefined
          : ({ describe, update } as unknown as SettingsFace);
      }
      return undefined;
    },
    effect: (effect: () => unknown) => effect(),
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: () => () => {},
    },
  };
  bindClientContext(ctx as unknown as ClientContext);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(SettingsItem, { t }));
  });
  renderers.push(renderer);
  return { renderer, describe, update };
}

function switchOf(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "switch" });
}

function statusOf(renderer: ReactTestRenderer): string | undefined {
  return renderer.root.findAllByProps({ role: "status" })[0]?.props.children;
}

beforeEach(() => setEnabled(true));
afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
});

describe("prompt suggestion settings row", () => {
  it("loads the saved switch and persists one revision-guarded update", async () => {
    const { renderer, describe, update } = await mount({});
    expect(describe).toHaveBeenCalledTimes(1);
    expect(switchOf(renderer).props["aria-checked"]).toBe(true);
    expect(switchOf(renderer).props.disabled).toBe(false);

    await act(async () => {
      switchOf(renderer).props.onClick();
    });

    expect(update).toHaveBeenCalledWith(NS, { enabled: false }, 3);
    expect(switchOf(renderer).props["aria-checked"]).toBe(false);
    expect(statusOf(renderer)).toBe(t("saved"));
    expect(enabledSnapshot()).toBe(false);
  });

  it("keeps a read-only profile inert and reports it", async () => {
    const { renderer, update } = await mount({
      describe: async () => describeValue(true, 3, false),
    });
    expect(switchOf(renderer).props.disabled).toBe(true);
    expect(statusOf(renderer)).toBe(t("readonly"));
    await act(async () => {
      switchOf(renderer).props.onClick();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("reloads after a revision conflict before another write", async () => {
    let reads = 0;
    const { renderer, update } = await mount({
      describe: async () => {
        reads += 1;
        return describeValue(true, reads === 1 ? 3 : 5);
      },
      update: async () => ({ ok: false, error: { code: "settings/conflict" } }),
    });
    await act(async () => {
      switchOf(renderer).props.onClick();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(statusOf(renderer)).toBe(t("conflict"));
    // The reload accepted revision 5, so a second attempt uses that guard.
    expect(switchOf(renderer).props.disabled).toBe(false);
    await act(async () => {
      switchOf(renderer).props.onClick();
    });
    expect(update).toHaveBeenLastCalledWith(NS, { enabled: false }, 5);
  });

  it("reports a rejected load and fails closed", async () => {
    const { renderer } = await mount({
      describe: async () => {
        throw new Error("Disconnected");
      },
    });
    expect(statusOf(renderer)).toBe("Disconnected");
    expect(switchOf(renderer).props.disabled).toBe(true);
  });

  it("ends loading when the settings service is unavailable", async () => {
    const { renderer } = await mount({ missingSettings: true });
    expect(statusOf(renderer)).toBe(t("failed"));
    expect(switchOf(renderer).props.disabled).toBe(true);
  });

  it("keeps the switch usable after a save failure and restores the saved value", async () => {
    const { renderer } = await mount({
      update: async () => ({ ok: false, error: { message: "Write failed" } }),
    });
    await act(async () => {
      switchOf(renderer).props.onClick();
    });
    expect(statusOf(renderer)).toBe("Write failed");
    expect(switchOf(renderer).props["aria-checked"]).toBe(true);
  });
});
