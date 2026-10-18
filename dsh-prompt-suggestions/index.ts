/**
 * Optional next-message suggestions for the DeepSeek Harness composer.
 *
 * After a successful turn, the Host half makes one bounded auxiliary model
 * request using the conversation's current route and its eight most recent
 * visible exchanges. The result is held in memory only; the browser half
 * renders it as dim ghost text in an empty composer and fills the draft on Tab
 * or Right Arrow. Nothing is appended to the session log and the suggestion
 * request has no tools, hooks, connectors, environment access, or goal.
 *
 * @module @indexyz/dsh-prompt-suggestions
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";

import { PLUGIN_NAME, SETTINGS_NS, SUGGEST_PATH } from "./src/host/constants.ts";
import { SuggestionEngine } from "./src/host/engine.ts";
import type { SuggestionConfig } from "./src/host/engine.ts";
import { handleSuggestionRequest } from "./src/host/route.ts";

export { SETTINGS_NS };
export { MAX_HISTORY_TURNS, SUGGESTION_TIMEOUT_MS } from "./src/host/constants.ts";
export type { SuggestionReply } from "./src/host/engine.ts";

/** Plugin identity used by the Loader and diagnostics. */
export const name = PLUGIN_NAME;

/** Host-plane services needed before the engine can observe turns and call the model. */
export const inject = ["llm", "sessions"] as const;

/**
 * Settings-editable row configuration.
 *
 * `enabled` is volatile so the Settings page can list and write it through the
 * Host settings service, and so a saved value reaches the running plugin
 * without a restart.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
});

/**
 * Observe completed turns and expose the authenticated suggestion route.
 *
 * @param ctx - Host-plane context carrying sessions, the LLM service, and the
 *   optional Connection service.
 * @param config - validated row configuration; `enabled` arrives as a live
 *   reference when the Loader parses it.
 */
export function apply(ctx: Context, config: SuggestionConfig = {}): void {
  const engine = new SuggestionEngine(ctx, config);
  ctx.effect(() => () => engine.dispose(), "dsh-prompt-suggestions: engine");
  ctx.on("session/event", (session, event) => engine.observe(session, event));
  ctx.on("session/disposed", (session) => engine.forget(session));
  ctx.inject(["connection"], (scope) => {
    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: SUGGEST_PATH,
          methods: ["POST"],
          requestBody: "buffered",
          fetch: (request) => handleSuggestionRequest(engine, request),
        }),
      "dsh-prompt-suggestions: suggestion route",
    );
  });
}
