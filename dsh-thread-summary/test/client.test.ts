import { describe, expect, it } from "vitest";
import { apply } from "../src/client/index.tsx";

describe("thread summary client", () => {
  it("registers an additive General setting row", () => {
    let registration: Record<string, unknown> | undefined;
    let injected = "";
    const ctx = {
      get: () => undefined,
      effect(effect: () => unknown) {
        effect();
      },
      locale: {
        register: () => () => {},
        bind: () => (key: string) => key,
      },
      slots: {
        inject(name: string, callback: () => unknown) {
          injected = name;
          callback();
        },
        register(options: Record<string, unknown>) {
          registration = options;
          return () => {};
        },
      },
    };
    apply(ctx);
    expect(injected).toBe("settings.general.item");
    expect(registration).toMatchObject({
      name: "settings.general.item",
      id: "thread-summary",
      order: 40,
    });
  });
});
