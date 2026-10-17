import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, ModelPicker, SummaryBoundary, SummaryItem } from "../src/client/index.tsx";

const namespace = (model = "first/old", revision = 3, enabled = true) => ({
  ns: "thread-summary",
  revision,
  value: { enabled, model },
});
const describeValue = (model = "first/old", revision = 3, writable = true) => ({
  ok: true as const,
  value: { writable, namespaces: [namespace(model, revision)] },
});
const catalog = {
  ok: true as const,
  value: {
    groups: [
      {
        id: "first",
        name: "First",
        models: [
          { id: "old", name: "Old" },
          { id: "new", name: "New" },
        ],
      },
      { id: "second", name: "Second", models: [{ id: "other", name: "Other" }] },
    ],
  },
};
const renderers: ReactTestRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
});

async function mount(
  overrides: {
    describe?: () => Promise<unknown>;
    update?: (...args: unknown[]) => Promise<unknown>;
    modelCatalog?: () => Promise<unknown>;
    missingSettings?: boolean;
  } = {},
) {
  const describeSettings = vi.fn<() => Promise<unknown>>(
    overrides.describe ?? (async () => describeValue()),
  );
  const update = vi.fn<(...args: unknown[]) => Promise<unknown>>(
    overrides.update ??
      (async (_ns, patch) => ({ ok: true, value: { ...namespace("first/new", 4), value: patch } })),
  );
  const modelCatalog = vi.fn<() => Promise<unknown>>(
    overrides.modelCatalog ?? (async () => catalog),
  );
  const ctx = {
    get(service: string) {
      if (service === "remote.settings")
        return overrides.missingSettings ? undefined : { describe: describeSettings, update };
      if (service === "remote.session") return { modelCatalog };
      return undefined;
    },
    effect: (effect: () => unknown) => effect(),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: () => () => {},
    },
  };
  apply(ctx as unknown as Parameters<typeof apply>[0]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(SummaryItem));
  });
  renderers.push(renderer);
  return { renderer, describeSettings, update, modelCatalog };
}

async function save(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.root.findByProps({ className: "dsh-summary-save" }).props.onClick();
  });
}

function status(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "status" }).props.children;
}

describe("thread summary settings row", () => {
  it("loads once, switches provider models and persists the revision", async () => {
    const { renderer, update, modelCatalog } = await mount();
    const selects = renderer.root.findAllByType(ModelPicker);
    expect(selects.map((item) => item.props.value)).toEqual(["first", "old"]);
    await act(async () => {
      selects[0]!.findByProps({ "aria-haspopup": "menu" }).props.onClick();
    });
    await act(async () => {
      renderer.root.findByProps({ "data-value": "second" }).props.onClick();
    });
    expect(selects[1]!.props.value).toBe("other");
    expect(selects[1]!.props.options).toEqual([{ id: "other", name: "Other" }]);
    expect(renderer.root.findAllByProps({ role: "menu" })).toHaveLength(0);
    await save(renderer);
    expect(update).toHaveBeenCalledWith(
      "thread-summary",
      { model: "second/other", enabled: true },
      3,
    );
    expect(modelCatalog).toHaveBeenCalledTimes(1);
    expect(status(renderer)).toBe("saved");
  });

  it("preserves an existing unavailable route", async () => {
    const { renderer } = await mount({
      describe: async () => describeValue("missing/vendor/model"),
    });
    expect(renderer.root.findAllByType(ModelPicker).map((item) => item.props.value)).toEqual([
      "missing",
      "vendor/model",
    ]);
  });

  it("permits disabling without a configured model or catalog", async () => {
    const { renderer, update } = await mount({
      describe: async () => describeValue(""),
      modelCatalog: async () => ({ ok: true, value: { groups: [] } }),
    });
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(true);
    await act(async () => {
      renderer.root.findByProps({ role: "switch" }).props.onClick();
    });
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(false);
    await save(renderer);
    expect(update).toHaveBeenCalledWith("thread-summary", { enabled: false }, 3);
  });

  it("keeps read-only settings disabled", async () => {
    const { renderer, update } = await mount({
      describe: async () => describeValue("first/old", 3, false),
    });
    expect(renderer.root.findByProps({ role: "switch" }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(true);
    expect(status(renderer)).toBe("readonly");
    await save(renderer);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a rejected settings load and fails closed", async () => {
    const { renderer, update } = await mount({
      describe: async () => {
        throw new Error("Disconnected");
      },
    });
    expect(status(renderer)).toBe("Disconnected");
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ role: "switch" }).props.disabled).toBe(true);
    await save(renderer);
    expect(update).not.toHaveBeenCalled();
  });

  it("ends loading when settings are unavailable", async () => {
    const { renderer } = await mount({ missingSettings: true });
    expect(status(renderer)).toBe("failed");
    expect(renderer.root.findAllByType(ModelPicker)[0]!.props.placeholder).toBe("noProviders");
  });

  it("reports a rejected catalog while keeping saved settings usable", async () => {
    const { renderer } = await mount({
      modelCatalog: async () => {
        throw new Error("Catalog offline");
      },
    });
    expect(status(renderer)).toBe("Catalog offline");
    expect(renderer.root.findAllByType(ModelPicker).map((item) => item.props.value)).toEqual([
      "first",
      "old",
    ]);
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(false);
  });

  it("reloads a conflicting revision before another write", async () => {
    let reads = 0;
    const { renderer, update } = await mount({
      describe: async () => (++reads === 1 ? describeValue() : describeValue("second/other", 8)),
      update: async () => ({ ok: false, error: { code: "settings/conflict" } }),
    });
    await save(renderer);
    expect(status(renderer)).toBe("conflict");
    expect(renderer.root.findAllByType(ModelPicker).map((item) => item.props.value)).toEqual([
      "second",
      "other",
    ]);
    await save(renderer);
    expect(update).toHaveBeenLastCalledWith(
      "thread-summary",
      { model: "second/other", enabled: true },
      8,
    );
  });

  it("blocks writes if conflict reload fails", async () => {
    let reads = 0;
    const { renderer, update } = await mount({
      describe: async () => {
        if (++reads === 1) return describeValue();
        throw new Error("Reload failed");
      },
      update: async () => ({ ok: false, error: { code: "settings/conflict" } }),
    });
    await save(renderer);
    expect(status(renderer)).toBe("Reload failed");
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(true);
    await save(renderer);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("contains rejected writes and restores the save button", async () => {
    const { renderer } = await mount({
      update: async () => {
        throw new Error("Save failed");
      },
    });
    await save(renderer);
    expect(status(renderer)).toBe("Save failed");
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(false);
  });

  it("prevents duplicate writes while a save is pending", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const { renderer, update } = await mount({ update: async () => pending });
    await act(async () => {
      const click = renderer.root.findByProps({ className: "dsh-summary-save" }).props.onClick;
      click();
      click();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(true);
    await act(async () => {
      resolve({ ok: true, value: namespace("first/old", 4) });
    });
    expect(renderer.root.findByProps({ className: "dsh-summary-save" }).props.disabled).toBe(false);
  });

  it("contains rendering failures within the settings boundary", async () => {
    function Broken(): React.ReactElement {
      throw new Error("render failed");
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(SummaryBoundary, {
            fallback: "Unavailable",
            children: React.createElement(Broken),
          }),
        );
      });
      renderers.push(renderer);
      expect(renderer.root.findByProps({ role: "alert" }).props.children).toBe("Unavailable");
    } finally {
      consoleError.mockRestore();
    }
  });
});
