import { describe, expect, it } from "vitest";

import {
  DEFAULT_IDLE_MINUTES,
  formatDuration,
  MAX_IDLE_MINUTES,
  resolveIdleSettings,
} from "../settings.ts";

describe("resolveIdleSettings", () => {
  it("defaults to enabled after 50 minutes", () => {
    expect(resolveIdleSettings({}, "p", "m")).toEqual({ enabled: true, idleMinutes: 50 });
    expect(DEFAULT_IDLE_MINUTES).toBe(50);
  });

  it("resolves each field from model, then provider, then the top level", () => {
    const settings = {
      piIdleCompression: {
        enabled: false,
        idleMinutes: 50,
        providers: { p: { enabled: true, idleMinutes: 30 } },
        models: { "p/m": { idleMinutes: 10 }, "q/x": { enabled: true } },
      },
    };
    expect(resolveIdleSettings(settings, "p", "m")).toEqual({ enabled: true, idleMinutes: 10 });
    expect(resolveIdleSettings(settings, "p", "other")).toEqual({ enabled: true, idleMinutes: 30 });
    expect(resolveIdleSettings(settings, "q", "x")).toEqual({ enabled: true, idleMinutes: 50 });
    expect(resolveIdleSettings(settings, "q", "y")).toEqual({ enabled: false, idleMinutes: 50 });
  });

  it("accepts fractional minutes up to the largest timer delay", () => {
    const at = (idleMinutes: number) =>
      resolveIdleSettings({ piIdleCompression: { idleMinutes } }, "p", "m").idleMinutes;
    expect(at(0.5)).toBe(0.5);
    expect(at(MAX_IDLE_MINUTES)).toBe(MAX_IDLE_MINUTES);
    expect(MAX_IDLE_MINUTES * 60_000).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_IDLE_MINUTES + 1, "50", null])(
    "rejects idleMinutes %s",
    (idleMinutes) => {
      expect(() => resolveIdleSettings({ piIdleCompression: { idleMinutes } }, "p", "m")).toThrow(
        /piIdleCompression\.idleMinutes must be a number of minutes/,
      );
    },
  );

  it("validates layers a more specific one overrides", () => {
    const settings = {
      piIdleCompression: {
        providers: { p: { enabled: "no" } },
        models: { "p/m": { enabled: true } },
      },
    };
    expect(() => resolveIdleSettings(settings, "p", "m")).toThrow(
      'piIdleCompression.providers["p"].enabled must be true or false',
    );
  });

  it.each([
    [{ piIdleCompression: [] }, "piIdleCompression must be an object"],
    [{ piIdleCompression: { providers: 1 } }, "piIdleCompression.providers must be an object"],
    [
      { piIdleCompression: { models: { "p/m": 5 } } },
      'piIdleCompression.models["p/m"] must be an object',
    ],
  ])("rejects malformed structure %j", (settings, error) => {
    expect(() => resolveIdleSettings(settings, "p", "m")).toThrow(error);
  });
});

describe("formatDuration", () => {
  it.each([
    [50 * 60_000, "50m"],
    [90 * 60_000, "1h 30m"],
    [61_000, "1m 1s"],
    [1200, "2s"],
    [-5, "0s"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
