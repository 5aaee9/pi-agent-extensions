/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClientContext,
  ConnectionFace,
  InputActions,
  InputState,
  SessionSnapshot,
  ShortcutsFace,
} from "../src/client/contracts.ts";
import { NS } from "../src/client/contracts.ts";
import { bindClientContext } from "../src/client/context.ts";
import { DICT } from "../src/client/dictionary.ts";
import { setEnabled } from "../src/client/enabled.ts";
import { SuggestionOverlay } from "../src/client/overlay.tsx";

const t = (key: string): string => DICT.en[key as keyof typeof DICT.en] ?? key;

interface MutableInput extends InputState {
  draft: string;
}

interface MutableSession extends SessionSnapshot {
  running: boolean;
  blank: boolean;
  openState: SessionSnapshot["openState"];
}

const renderers: ReactTestRenderer[] = [];

function buildComposer(): void {
  document.body.innerHTML = `
    <div data-composer-card>
      <div style="position: relative">
        <div data-composer-placeholder style="position: absolute; top: 4px; left: 8px; right: 8px">Ask anything</div>
        <div contenteditable="true"></div>
      </div>
    </div>`;
}

function editor(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (element === null) throw new Error("editor missing");
  return element;
}

function ghost(): Element | null {
  return document.querySelector("[data-prompt-suggestions]");
}

function ghostText(): string {
  return ghost()?.querySelector("span")?.textContent ?? "";
}

interface MountOptions {
  input?: Partial<MutableInput>;
  session?: Partial<MutableSession>;
  connection?: ConnectionFace;
  shortcuts?: ShortcutsFace;
  enabled?: boolean;
}

async function mount(options: MountOptions = {}) {
  buildComposer();
  setEnabled(options.enabled ?? true);
  const input: MutableInput = {
    draft: "",
    phase: "plain",
    attachmentIds: [],
    ...options.input,
  };
  const session: MutableSession = {
    running: false,
    blank: false,
    openState: "open",
    removed: false,
    lastAgentError: null,
    ...options.session,
  };
  const call = vi.fn<ConnectionFace["rpc"]["call"]>(
    options.connection?.rpc.call ??
      (async () => ({ ok: true as const, value: { state: "ready", text: "Add a test" } })),
  );
  const connection: ConnectionFace = options.connection ?? { rpc: { call } };
  const settings = {
    describe: async () => ({
      ok: true as const,
      value: { writable: true, namespaces: [{ ns: NS, revision: 1, value: { enabled: true } }] },
    }),
    update: async () => ({ ok: true as const, value: { ns: NS, revision: 2, value: {} } }),
  };
  const ctx = {
    get(name: string): unknown {
      if (name === "connection") return connection;
      if (name === "remote.settings") return settings;
      if (name === "shortcuts") return options.shortcuts;
      return undefined;
    },
    effect: (effect: () => unknown) => effect(),
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: () => () => {},
    },
  };
  bindClientContext(ctx as unknown as ClientContext);

  const insertText = vi.fn<InputActions["insertText"]>(() => true);
  const setDraft = vi.fn<InputActions["setDraft"]>();
  const inputActions: InputActions = {
    captureInsertion: () => ({ start: 0, end: 0 }),
    insertText,
    setDraft,
  };
  const useInput = <Selected>(selector: (value: InputState) => Selected): Selected =>
    selector(input);
  const useSession = <Selected>(selector: (value: SessionSnapshot) => Selected): Selected =>
    selector(session);

  const card = document.querySelector<HTMLElement>("[data-composer-card]");
  if (card === null) throw new Error("composer missing");
  const createNodeMock = (): HTMLElement => {
    const anchor = document.createElement("span");
    anchor.hidden = true;
    anchor.setAttribute("aria-hidden", "true");
    card.append(anchor);
    return anchor;
  };
  const element = React.createElement(SuggestionOverlay, {
    sessionId: "session-1",
    useInput,
    useSession,
    inputActions,
    t,
  });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element, { createNodeMock });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  renderers.push(renderer);
  return { renderer, element, rpc: call, insertText, setDraft, input, session };
}

async function settle(renderer: ReactTestRenderer, element: React.ReactElement): Promise<void> {
  await act(async () => {
    renderer.update(React.cloneElement(element));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function key(target: HTMLElement, keyValue: string, code = keyValue): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: keyValue,
        code,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

beforeEach(() => setEnabled(true));
afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
  document.body.innerHTML = "";
});

describe("composer suggestion overlay", () => {
  it("places dim text over the native placeholder for the current session", async () => {
    const { rpc } = await mount();
    expect(rpc).toHaveBeenCalledWith(
      "/api",
      "prompt-suggestions/suggest",
      { sessionId: "session-1" },
      expect.any(AbortSignal),
    );
    expect(ghost()).not.toBeNull();
    expect(ghostText()).toBe("Add a test");
    expect(
      document.querySelector<HTMLElement>("[data-composer-placeholder]")?.style.visibility,
    ).toBe("hidden");
  });

  it.each([
    ["Tab", "Tab"],
    ["ArrowRight", "ArrowRight"],
  ])("inserts the suggestion into the draft for %s", async (keyValue, code) => {
    const { insertText, setDraft, renderer, element } = await mount();
    await key(editor(), keyValue, code);
    expect(insertText).toHaveBeenCalledWith("Add a test", { start: 0, end: 0 });
    expect(setDraft).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
    // The draft is owned by the composer, not this overlay.
    await settle(renderer, element);
  });

  it("dismisses on Escape without inserting", async () => {
    const { insertText } = await mount();
    await key(editor(), "Escape");
    expect(insertText).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it("hides while typing and reappears when the draft becomes empty again", async () => {
    const { renderer, element, input } = await mount();
    expect(ghost()).not.toBeNull();
    input.draft = "hello";
    await settle(renderer, element);
    expect(ghost()).toBeNull();
    input.draft = "";
    await settle(renderer, element);
    expect(ghost()).not.toBeNull();
  });

  it("defers a bare Tab already owned by a custom shortcut", async () => {
    const { insertText } = await mount({
      shortcuts: {
        catalog: {
          getSnapshot: () => [{ binding: { code: "Tab", modifiers: [] } }],
        },
      },
    });
    await key(editor(), "Tab");
    expect(insertText).not.toHaveBeenCalled();
    expect(ghost()).not.toBeNull();
  });

  it("defers Tab while a popup menu is open", async () => {
    const { insertText } = await mount();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    Object.defineProperty(menu, "offsetParent", { value: document.body });
    document.body.append(menu);
    await key(editor(), "Tab");
    expect(insertText).not.toHaveBeenCalled();
    expect(ghost()).not.toBeNull();
  });

  it("does not paint with an attachment, draft, or running turn", async () => {
    const attachments = await mount({ input: { attachmentIds: ["file"] } });
    // The session is still watched so a later turn can generate while attached.
    expect(attachments.rpc).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();
    act(() => attachments.renderer.unmount());
    renderers.splice(renderers.indexOf(attachments.renderer), 1);

    const draft = await mount({ input: { draft: "already typing" } });
    expect(draft.rpc).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();
    act(() => draft.renderer.unmount());
    renderers.splice(renderers.indexOf(draft.renderer), 1);

    const running = await mount({ session: { running: true } });
    expect(running.rpc).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();
  });

  it("shows an already-fetched suggestion when the draft is cleared", async () => {
    const { renderer, element, input, rpc } = await mount({
      input: { draft: "already typing" },
    });
    expect(ghost()).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    input.draft = "";
    await settle(renderer, element);
    expect(ghostText()).toBe("Add a test");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("aborts the pending query when the overlay unmounts", async () => {
    const { rpc, renderer } = await mount();
    const signal = rpc.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);
    act(() => renderer.unmount());
    renderers.splice(renderers.indexOf(renderer), 1);
    expect(signal?.aborted).toBe(true);
  });

  it("hides immediately when the settings switch turns off", async () => {
    const { renderer, element } = await mount();
    expect(ghost()).not.toBeNull();
    act(() => setEnabled(false));
    await settle(renderer, element);
    expect(ghost()).toBeNull();
  });
});
