import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";

import { ENDPOINT_WAIT_MS, MAX_HISTORY_TURNS } from "./constants.ts";
import { generateSuggestion, resolveSuggestionRoute } from "./generate.ts";
import { buildSuggestionPrompt, messageText, selectRecentTurns } from "./history.ts";

/** A `.volatile()` Config field, read live so Settings writes apply without restart. */
export interface VolatileField<T> {
  get(): T | undefined;
}

/** The Host half's settings-editable configuration. */
export interface SuggestionConfig {
  enabled?: boolean | VolatileField<boolean>;
}

/** One answer to a browser suggestion query. */
export type SuggestionReply =
  | { readonly state: "ready"; readonly text: string }
  | { readonly state: "pending" }
  | { readonly state: "none" }
  | { readonly state: "disabled" };

interface SessionSuggestionState {
  watched: boolean;
  completedTurn: number | undefined;
  status: "none" | "pending" | "ready";
  text: string;
  controller: AbortController | undefined;
  readonly waiters: Set<() => void>;
}

function liveEnabled(config: SuggestionConfig): boolean {
  const value = config.enabled;
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  return value.get() ?? true;
}

function newState(): SessionSuggestionState {
  return {
    watched: false,
    completedTurn: undefined,
    status: "none",
    text: "",
    controller: undefined,
    waiters: new Set(),
  };
}

function replyOf(state: SessionSuggestionState): SuggestionReply {
  if (state.status === "ready" && state.text !== "") {
    return { state: "ready", text: state.text };
  }
  if (state.status === "pending") return { state: "pending" };
  return { state: "none" };
}

/** Whether a completed turn contains a human prompt and visible assistant text. */
export function turnHasPredictionInput(session: Session, turn: number): boolean {
  const events = session.snapshotEvents();
  let hasUser = false;
  let hasAssistant = false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.type === "turn/start" && event.data.turn === turn) break;
    if (
      event.type === "user/message" &&
      event.data.source.kind === "user" &&
      messageText(event.data) !== ""
    ) {
      hasUser = true;
    }
    if (event.type === "assistant/message" && messageText(event.data.message) !== "") {
      hasAssistant = true;
    }
  }
  return hasUser && hasAssistant;
}

/**
 * Generate one ephemeral next-message suggestion per eligible completed turn.
 *
 * The engine is deliberately not a session writer: generation reads derived
 * history and streams one auxiliary model response, and the result lives only
 * in this Host process' memory until the browser reads it or a new turn
 * invalidates it. The browser's first query marks a session as watched, so
 * compositions without a composer do not spend model calls.
 */
export class SuggestionEngine {
  private readonly states = new Map<string, SessionSuggestionState>();

  /**
   * @param ctx - Host context providing sessions, the LLM service, and logging.
   * @param config - live settings configuration.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: SuggestionConfig,
  ) {}

  /** Observe turn boundaries and keep per-session state fresh. */
  observe(session: Session, event: SessionEvent): void {
    if (event.type === "turn/start") {
      const state = this.states.get(session.id);
      if (state === undefined) return;
      this.cancel(state);
      state.completedTurn = undefined;
      state.status = "none";
      state.text = "";
      this.notify(state);
      return;
    }
    if (event.type !== "turn/end") return;
    const state = this.states.get(session.id);
    if (state === undefined) return;
    if (event.data.reason.kind !== "completed") {
      this.cancel(state);
      state.completedTurn = undefined;
      state.status = "none";
      state.text = "";
      this.notify(state);
      return;
    }
    state.completedTurn = event.data.turn;
    state.status = "none";
    state.text = "";
    if (state.watched && this.enabled()) this.startGeneration(session, state);
    else this.notify(state);
  }

  /** Drop every trace of a session that left the store. */
  forget(session: Session): void {
    const state = this.states.get(session.id);
    if (state === undefined) return;
    this.cancel(state);
    this.notify(state);
    this.states.delete(session.id);
  }

  /** Abort every in-flight generation and release waiters. */
  dispose(): void {
    for (const state of this.states.values()) {
      this.cancel(state);
      this.notify(state);
    }
    this.states.clear();
  }

  /**
   * Answer one browser query, waiting briefly for an in-flight generation.
   *
   * The first query for a live session marks it watched. Generation itself
   * starts only from a live `turn/end`, so replayed history never spends a
   * request. A query that arrives while the model is still working waits up to
   * the endpoint budget and then returns `pending`; the browser retries until a
   * terminal answer.
   * @param rawSessionId - untrusted wire session identity.
   * @param signal - request cancellation from the browser.
   * @returns the current suggestion state.
   */
  async request(rawSessionId: string, signal: AbortSignal): Promise<SuggestionReply> {
    if (!this.enabled()) return { state: "disabled" };
    const session = this.ctx.sessions.get(SessionId(rawSessionId));
    if (session === undefined) return { state: "none" };

    let state = this.states.get(session.id);
    if (state === undefined) {
      state = newState();
      this.states.set(session.id, state);
    }
    state.watched = true;

    if (state.status === "pending") {
      await this.waitForChange(state, signal, ENDPOINT_WAIT_MS);
      // The browser aborts this query when the composer disappears, the
      // session switches, or the switch turns off. No one can observe the
      // result then, so release the in-flight model call instead of spending
      // the rest of its deadline.
      if (signal.aborted && state.status === "pending") {
        this.cancel(state);
        state.completedTurn = undefined;
        this.notify(state);
      }
    }

    if (!this.enabled()) return { state: "disabled" };
    return replyOf(state);
  }

  private enabled(): boolean {
    return liveEnabled(this.config);
  }

  private startGeneration(session: Session, state: SessionSuggestionState): void {
    const turn = state.completedTurn;
    if (
      turn === undefined ||
      state.status === "pending" ||
      state.controller !== undefined ||
      !this.enabled() ||
      !turnHasPredictionInput(session, turn)
    ) {
      state.status = "none";
      this.notify(state);
      return;
    }
    const controller = new AbortController();
    state.controller = controller;
    state.status = "pending";
    void this.runGeneration(session, state, controller);
  }

  private async runGeneration(
    session: Session,
    state: SessionSuggestionState,
    controller: AbortController,
  ): Promise<void> {
    try {
      const turns = selectRecentTurns(session.deriveMessages(), MAX_HISTORY_TURNS);
      if (turns.length === 0) {
        this.finish(state, controller, "none", "");
        return;
      }
      const route = await resolveSuggestionRoute(this.ctx.llm, session, controller.signal);
      if (route === undefined) {
        this.finish(state, controller, "none", "");
        return;
      }
      const prompt = buildSuggestionPrompt(turns);
      if (prompt === "") {
        this.finish(state, controller, "none", "");
        return;
      }
      const text = await generateSuggestion(
        this.ctx.llm,
        route,
        prompt,
        session.id,
        controller.signal,
      );
      this.finish(state, controller, text === "" ? "none" : "ready", text);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.ctx.logger.debug(
          `prompt-suggestions: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.finish(state, controller, "none", "");
    }
  }

  private finish(
    state: SessionSuggestionState,
    controller: AbortController,
    status: "none" | "ready",
    text: string,
  ): void {
    if (state.controller !== controller) return;
    state.controller = undefined;
    if (controller.signal.aborted) {
      state.status = "none";
      state.text = "";
    } else {
      state.status = status;
      state.text = text;
    }
    this.notify(state);
  }

  private cancel(state: SessionSuggestionState): void {
    state.controller?.abort();
    state.controller = undefined;
    state.status = "none";
    state.text = "";
  }

  private notify(state: SessionSuggestionState): void {
    const waiters = [...state.waiters];
    state.waiters.clear();
    for (const waiter of waiters) waiter();
  }

  private waitForChange(
    state: SessionSuggestionState,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (settled) return;
        settled = true;
        state.waiters.delete(done);
        signal.removeEventListener("abort", done);
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      state.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
      timer = setTimeout(done, timeoutMs);
    });
  }
}
