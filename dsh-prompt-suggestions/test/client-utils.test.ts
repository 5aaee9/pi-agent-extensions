/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import type { ShortcutsFace } from "../src/client/contracts.ts";
import { createGhost, findComposer, placeGhost } from "../src/client/ghost.ts";
import { acceptKeyOf, hasCustomBinding, menuOpen } from "../src/client/input.ts";
import { parseSuggestionReply } from "../src/client/query.ts";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("wire reply validation", () => {
  it.each([
    [
      { state: "ready", text: "Add a test" },
      { state: "ready", text: "Add a test" },
    ],
    [{ state: "pending" }, { state: "pending" }],
    [{ state: "disabled" }, { state: "disabled" }],
    [{ state: "ready", text: "   " }, { state: "none" }],
    [{ state: "ready" }, { state: "none" }],
    [{ state: "weird" }, { state: "none" }],
    ["nope", { state: "none" }],
    [null, { state: "none" }],
  ])("parses %j", (value, expected) => {
    expect(parseSuggestionReply(value)).toEqual(expected);
  });
});

describe("acceptance gesture priority", () => {
  it("accepts only bare Tab and Right Arrow", () => {
    expect(acceptKeyOf(keyEvent({ key: "Tab" }))).toBe("Tab");
    expect(acceptKeyOf(keyEvent({ key: "ArrowRight" }))).toBe("ArrowRight");
    expect(acceptKeyOf(keyEvent({ key: "Tab", shiftKey: true }))).toBeUndefined();
    expect(acceptKeyOf(keyEvent({ key: "ArrowRight", ctrlKey: true }))).toBeUndefined();
    expect(acceptKeyOf(keyEvent({ key: "Enter" }))).toBeUndefined();
  });

  it("defers to custom editable and fixed bare bindings only", () => {
    const shortcuts = {
      catalog: {
        getSnapshot: () => [{ binding: { code: "Tab", modifiers: [] } }],
      },
      fixedCatalog: {
        getSnapshot: () => [
          { bindings: [{ code: "ArrowRight", modifiers: ["shift"] }] },
          { bindings: [{ code: "ArrowRight", modifiers: [] }] },
        ],
      },
    } satisfies ShortcutsFace;
    expect(hasCustomBinding(shortcuts, "Tab")).toBe(true);
    expect(hasCustomBinding(shortcuts, "ArrowRight")).toBe(true);
    expect(hasCustomBinding(shortcuts, "Enter")).toBe(false);
    expect(hasCustomBinding(undefined, "Tab")).toBe(false);
    expect(
      hasCustomBinding(
        {
          catalog: { getSnapshot: () => [{ binding: { code: "Tab", modifiers: ["shift"] } }] },
        },
        "Tab",
      ),
    ).toBe(false);
  });

  it("detects only visible popups", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    expect(menuOpen(document)).toBe(false);
    Object.defineProperty(menu, "offsetParent", { value: document.body });
    document.body.append(menu);
    expect(menuOpen(document)).toBe(true);
    menu.remove();
    expect(menuOpen(document)).toBe(false);
  });
});

describe("composer DOM helpers", () => {
  function build(): { anchor: HTMLElement; placeholder: HTMLElement; card: HTMLElement } {
    document.body.innerHTML = `
      <div data-composer-card>
        <div style="position: relative">
          <div data-composer-placeholder style="position: absolute; top: 4px; left: 8px; right: 8px">Ask</div>
          <div contenteditable="true"></div>
          <span data-anchor></span>
        </div>
      </div>`;
    const card = document.querySelector<HTMLElement>("[data-composer-card]");
    const placeholder = document.querySelector<HTMLElement>("[data-composer-placeholder]");
    const anchor = document.querySelector<HTMLElement>("[data-anchor]");
    if (card === null || placeholder === null || anchor === null)
      throw new Error("fixture missing");
    return { anchor, placeholder, card };
  }

  it("locates the composer around the overlay anchor", () => {
    const { anchor, placeholder } = build();
    expect(findComposer(anchor)).toMatchObject({ placeholder });
    expect(findComposer(null)).toBeUndefined();
    placeholder.remove();
    expect(findComposer(anchor)).toBeUndefined();
  });

  it("paints over the placeholder and restores it on cleanup", () => {
    const { anchor, placeholder } = build();
    const parts = findComposer(anchor);
    if (parts === undefined) throw new Error("composer missing");
    const ghost = createGhost(document);
    const cleanup = placeGhost(ghost, "Suggested next message", placeholder);
    expect(cleanup).toBeTypeOf("function");
    expect(ghost.text.textContent).toBe("Suggested next message");
    expect(ghost.hint.textContent).toBe("Tab");
    expect(placeholder.style.visibility).toBe("hidden");
    expect(document.querySelector("[data-prompt-suggestions]")).toBe(ghost.root);
    cleanup?.();
    expect(placeholder.style.visibility).toBe("");
    expect(document.querySelector("[data-prompt-suggestions]")).toBeNull();
  });

  it("does not paint when the placeholder has no positioned parent", () => {
    const placeholder = document.createElement("div");
    const ghost = createGhost(document);
    expect(placeGhost(ghost, "text", placeholder)).toBeUndefined();
    expect(ghost.root.parentElement).toBeNull();
  });
});

describe("shared enabled store", () => {
  it("notifies subscribers only on change", async () => {
    const { enabledSnapshot, setEnabled, subscribeEnabled } =
      await import("../src/client/enabled.ts");
    setEnabled(true);
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeEnabled(listener);
    setEnabled(true);
    expect(listener).not.toHaveBeenCalled();
    setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(enabledSnapshot()).toBe(false);
    unsubscribe();
    setEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
