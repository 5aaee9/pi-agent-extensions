/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import type { SettingsFace } from "../src/client/contracts.ts";
import { NS } from "../src/client/contracts.ts";
import { DICT } from "../src/client/dictionary.ts";
import { readEnabled } from "../src/client/settings-client.ts";
import { loadClientPlugin, mountClient, settingsRow } from "./client-bundle.ts";

describe("prompt suggestion settings wiring", () => {
  function settingsFace(): SettingsFace {
    return {
      async describe() {
        return {
          ok: true as const,
          value: {
            writable: true,
            namespaces: [{ ns: NS, revision: 3, value: { enabled: true } }],
          },
        };
      },
      async update(_ns, patch, revision) {
        return {
          ok: true as const,
          value: { ns: NS, revision: (revision ?? 0) + 1, value: patch },
        };
      },
    };
  }

  it("registers the overlay and General settings rows through the built client module", async () => {
    const plugin = await loadClientPlugin();
    expect(plugin.inject).toEqual(["connection", "locale", "slots", "remote.settings"]);
    const mounted = await mountClient(plugin, {
      settings: settingsFace(),
      connection: {
        rpc: {
          async call() {
            return { ok: false as const, error: { message: "not used" } };
          },
        },
      },
    });
    expect(mounted.rows.map((row) => row.slot)).toEqual([
      "conversation.input.overlay",
      "settings.general.item",
    ]);
    const settings = settingsRow(mounted);
    expect(settings.options).toMatchObject({ id: NS, order: 45 });
    const label = settings.options["label"];
    expect(typeof label).toBe("function");
    expect((label as () => unknown)()).toBe(DICT.en.label);
    expect(mounted.dictionaries.get(NS)?.en?.["label"]).toBe(DICT.en.label);

    await mounted.dispose();
    expect(mounted.rows).toEqual([]);
    expect(mounted.dictionaries.size).toBe(0);
  });

  it("reads the saved switch, writability, and revision from the Host namespace", async () => {
    const describeValue = (value: {
      enabled?: boolean;
      writable?: boolean;
      revision?: number;
      found?: boolean;
    }): SettingsFace => ({
      async describe() {
        return {
          ok: true as const,
          value: {
            writable: value.writable ?? true,
            namespaces:
              value.found === false
                ? []
                : [
                    {
                      ns: NS,
                      revision: value.revision ?? 3,
                      value: { enabled: value.enabled ?? true },
                    },
                  ],
          },
        };
      },
      async update() {
        throw new Error("not used");
      },
    });
    await expect(readEnabled(describeValue({ enabled: true, revision: 3 }))).resolves.toEqual({
      found: true,
      enabled: true,
      writable: true,
      revision: 3,
    });
    await expect(readEnabled(describeValue({ enabled: false, writable: false }))).resolves.toEqual({
      found: true,
      enabled: false,
      writable: false,
      revision: 3,
    });
    await expect(readEnabled(describeValue({ found: false }))).resolves.toEqual({
      found: false,
      enabled: true,
      writable: true,
    });
  });

  it("surfaces a rejected settings read instead of guessing a value", async () => {
    const face: SettingsFace = {
      async describe() {
        return { ok: false as const, error: { message: "Disconnected" } };
      },
      async update() {
        throw new Error("not used");
      },
    };
    await expect(readEnabled(face)).rejects.toThrow("Disconnected");
  });
});

// Blocked on the primitives package's missing runtime deps (clsx, react-dom,
// shiki, katex, mdast, ...): the six row-render assertions (saved switch,
// read-only, conflict reload, rejected load, unavailable service, save failure)
// need the real `Switch` from @deepseek-ai/dsh-client-ui-primitives. They are
// not replaced with a stub component; see the package report.
