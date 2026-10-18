# Design

## Context

The rc.2 composer renders the resident input through Lexical and exposes `conversation.input.overlay` as an empty, session-scoped list inside the composer card. It has no second-placeholder or ghost-text slot. The Host exposes session turn events, the LLM stream API, and the authenticated Connection transport; the browser exposes `slots`, `locale`, `remote.settings`, `connection`, and optional `shortcuts`.

The reference implementations fall into two groups: a direct auxiliary LLM request with a DOM overlay, and a durable session/plugin record with a projection. The second requires a newer Harness than the package pins and conflicts with the requirement that suggestions stay out of the conversation. The first matches the requested ephemeral behavior; this port tightens its cost, validation, and priority rules.

## Goals / Non-Goals

**Goals:**

- One ephemeral suggestion after each eligible live reply, using the conversation route and low reasoning.
- Send only bounded visible user/assistant text; never send tools, reasoning, system prompts, attachments, or environment state.
- Never write the session log, never execute a suggested task, never submit automatically.
- Yield every acceptance key to any higher-priority composer owner.
- Make the global switch real, persisted, and immediately effective.

**Non-Goals:**

- Persist suggestions across reloads, replays, or sessions.
- A configurable suggestion model or prompt.
- Structured output or provider-specific schemas.
- A durable conversation entry, projection, or session event.
- Automatic acceptance, auto-submit, or background suggestion refresh.

## Decisions

1. **Direct auxiliary request, not a subagent thread.** `ctx.llm.stream()` gives an isolated, tool-free call with an explicit signal and no agent loop. It inherits no goal, hooks, connectors, or environment, writes no session record, and is disposed by the 30-second deadline. Creating a real thread would add a session to the store and a visible lifecycle, violating the ephemeral requirement.

2. **Exact Connection Fetch route.** The `/api` RPC channel accepts only one interceptor, owned by the gateway, so a plugin cannot intercept `/api`. Registering the exact `/api/prompt-suggestions/suggest` route is checked before the shared handler and is available only while the plugin and Connection service are loaded. The browser uses the standard `connection.rpc.call` envelope, so the client bundle does not import the connection package.

3. **Watched sessions and eager generation only.** The browser's first query marks a session watched. Generation happens on live `turn/end` only. A page reload cannot reconstruct the watched set, and restored/replayed turns publish no live events, so replay never triggers a request. This deliberately gives up a suggestion for the last turn after a refresh in exchange for never spending a request on replayed history.

4. **Per-session state machine.** Each session has one in-memory state: last completed turn, `none`/`pending`/`ready`, text, controller, and query waiters. `turn/start`, non-completed `turn/end`, session disposal, plugin disposal, and new-generation replacement abort the controller and settle every waiter. A query that arrives during `pending` waits up to 10 seconds; the browser retries with a bounded poll, and a query never starts a model call for an already-replayed turn. If the browser aborts the query (composer unmount, session switch, or switch off), the Host releases the in-flight model call and clears that completed turn instead of spending the rest of its deadline.

5. **Current route, cheapest effort.** The provider/model come from `session.requestHeader()?.config`. `resolveModelInfo` supplies the advertised effort list; the Host prefers `low`, then `off`, `minimal`, `none`, then the adapter's first level. When lookup fails it still uses the route and leaves the adapter default rather than blocking generation. `purpose` is omitted because rc.2 only accepts `compaction` and `session-title`.

6. **Bounded visible history.** `session.deriveMessages()` is filtered to direct human `user` messages and assistant text blocks, grouped into completed exchanges, and truncated to the newest eight. Reasoning and tool blocks are ignored. The system instructions and JSON framing share a 4,096-byte budget; oldest exchanges are dropped, then the remaining exchange is clipped at code-point boundaries while preserving valid JSON. The prompt states that the conversation is data and must not be executed.

7. **Validated single-line output.** The response must finish with `stop`, must contain no tool-call block, and is normalized to one line: fences, control/bidirectional characters, labels, and enclosing quotes are removed. Empty, meta-text, single-character, and over-limit results become "no suggestion". The display cap is 200 code points; the auxiliary output budget is 512 tokens to leave room for low-effort reasoning. Temperature is left to the adapter because reasoning-capable providers differ on it.

8. **DOM overlay over the native placeholder.** The slot body is one hidden anchor. The component finds the enclosing `[data-composer-card]`, its `[contenteditable="true"]` editor, and its `[data-composer-placeholder]`. It appends one inert row to the placeholder's positioned parent, copies typography/color/inset from the computed style, and hides the native placeholder with `visibility` rather than `display` so the composer never reflows. A `MutationObserver` on the document element repaints on theme changes. The row is `aria-hidden` with pointer events disabled. No Lexical internals are touched.

9. **Capture-phase acceptance with explicit priority.** The listener is installed only while the suggestion is visible. It ignores prevented events, IME composition, events outside the editor, open `role=listbox`/`role=menu`/trigger menus, any modifier, and bare Tab/Right-Arrow bindings present in the editable or fixed shortcut catalogs. Acceptance uses `captureInsertion()` + `insertText()` so a changed draft or locked editor refuses the insert; it never calls `submit()`. Escape and paste clear/dismiss. Typing hides by the empty-draft gate, and clearing the draft re-shows an already-fetched suggestion without another Host query.

10. **Immediate, revision-guarded settings.** The Host declares `enabled` as a volatile boolean, which surfaces it in the `prompt-suggestions` settings namespace. The General row saves on toggle with the reviewed revision. A conflict disables writes, reloads the namespace, and uses the new revision on the next attempt; read-only, missing service, and rejected load states stay inert with localized status. A tiny module store mirrors the switch so the overlay hides/reveals without a restart. Both slot bodies are wrapped in local error boundaries.

11. **Build and verification pins.** The Host imports `dsh-llm`, `dsh-session`, `dsh-timeout`, `dsh-client-connection` (types), `cordis`, and `schemastery`; the client imports React, the JSX runtime, and the shell's `Switch` primitive. All Host packages are `"*"` peers with exact rc.2 dev pins. The client bundle externalizes React and the primitive module. `release.smoke` reads the installed manifest, verifies the patch row and module-loader contract, and checks both slot registrations plus disposal.

## Risks / Trade-offs

- A page reload loses the in-memory suggestion; the last replayed turn is intentionally not re-requested. This is the cost of never treating replay as a trigger.
- The DOM contract (`data-composer-card`, placeholder and editor attributes) is not a public decoration API. A future composer change can break placement; the feature degrades to no ghost text rather than affecting input.
- Low-effort reasoning can still produce reasoning-only or token-limited output. Validation turns those cases into "no suggestion" instead of showing partial text.
- Some providers reject or ignore parameters on reasoning routes. Omitting `purpose` and `temperature` keeps the call portable; unsupported effort lookup falls back to the adapter default.
- A watched session adds one auxiliary request per completed reply. This is the requested behavior, but it is real token and latency cost; the switch is the global off ramp.
- The suggestion may be wrong or stale in intent. It is only inserted into the draft, never submitted, so the user can edit or discard it.

## Verification

Host tests cover turn eligibility, route/low-effort selection, eight-turn and byte budgets, Unicode-safe framing, output normalization, 30-second timeout and timer disposal, aborted/failed/model-invalid streams, live settings changes, watched-session generation, replay exclusion, stale-result cancellation, route envelopes, and no session writes. Browser tests cover wire validation, shortcut and popup priority, composer location, ghost placement/restoration, ghost text, Tab/Right-Arrow insertion, Escape, typing hide/re-show, draft/attachment/running suppression, abort on unmount, switch-driven hiding, and settings save/conflict/read-only/unavailable states.

The release smoke is run against the packed and installed tarball; `npm run check` covers formatting, lint, typecheck, build, all package tests, and release-tooling tests. Live web-profile verification with a real model is tracked separately and is not claimed from mocks.

## Migration Plan

This is a new package; no existing configuration or session data migrates. Install it into a dsh web profile, rebuild the Git-ignored host/browser artifacts before a local link install, restart the Harness for the Host half, and refresh the browser for the client half. The package starts with the `0.0.0` bootstrap workspace and follows the repository's first-release procedure before a formal version is pushed.
