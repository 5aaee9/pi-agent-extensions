# Design

## Context

See proposal.md, "Why", for the failures. The facts below come from Pi 1.6.0's source (`@earendil-works/pi-ai` `dist/api/openai-codex-responses.js`, `openai-responses-shared.js`, `utils/transcript.js`; `@earendil-works/pi-coding-agent` `session-manager.js`, `agent-session.js`). They were checked with throwaway e2e probes that ran the packed package against a local relay on Pi 1.5.0 and 1.6.0.

**How Pi 1.6.0 builds a Codex turn**

- Pi's Codex adapter builds `input` with `convertResponsesMessages`. The transcript's system messages become the first `input` item: `{ role, content: string }`. `role` is `developer` when the model reasons and `compat.supportsDeveloperRole !== false`, and `system` otherwise (`openai-responses-shared.js:169`).
- The `instructions` field is gone, and so is the serializer option `includeSystemPrompt`.
- When `compat.supportsMidConvoSystemMessages` is not set (sub2api sets no Codex compat), `collapseSystemMessages` folds every system message in the list, wherever it sits, into that one leading item (`transcript.js:58-104`). A tool-set change is one such message.
- When a `before_agent_start` handler returns `systemPrompt`, Pi projects the forced text as that leading item without recording it in the transcript (`agent-session.js` `_installAgentForcedPromptProjection`). `pi-ask` does this on every run.
- `ctx.getSystemPrompt()` returns the prompt of the current run, including a forced one, and otherwise the base prompt with the current tools (`agent-session.js:1139-1141`). Pi clears the run's options when the run ends (`:1537-1541`), and the compaction check at the start of a run happens before `before_agent_start` fires (`:1553-1561`). An idle `/compact` or `/openai-compress`, and a run-start threshold compaction, therefore see the base prompt even when an extension forces one on every turn. An in-run compaction, such as context-overflow recovery, sees the run's prompt as prepared for its request, so a tool change made during that run appears only from the next turn on.

**Compaction entries and sub2api's serializer**

- A compaction entry stores the system message current at compaction time (`entry.systemMessage`), and Pi emits it ahead of the compaction summary.
- sub2api's serializer (`serializeMessages`) mirrors the host's `convertResponsesMessages` call. It feeds three places:
  - the compaction request `input`;
  - the retained-message selection for the stored window: `selectRetainedV2Messages` retains `user`, `developer`, and `system` messages, newest first, within 64K estimated tokens;
  - the expected prefix that `rewriteProviderPayload` matches in a turn's `input` and replaces with the window.

**Codex and the repository**

- Current Codex (`openai/codex` `f342aa7`) sends its base instructions as a leading `developer` input item (`codex-rs/core/src/client.rs:1283-1291`). Its `ResponsesApiRequest` has no `instructions` field (`codex-api/src/common.rs:408`). Remote compaction v2 pushes `CompactionTrigger` onto the same prompt input.
- `scripts/e2e/pi/harness.e2e.ts:47-51` asserts that every registered Pi package pins the host version the suite runs.
- `pi-custom-provider/test/vendored-drift.test.ts` compares its vendored `buildBaseOptions` with the pinned host's. Since pi-ai 1.5.2 the host also forwards `disableContinuation`, and pi-ai 1.6.0's `clampMaxTokensToContext` keeps a 15% input safety margin while that still leaves 32,768 output tokens, and otherwise restores the fixed 4,096-token margin (`simple-options.js`). The ratio only exceeds the fixed margin above about 27,306 estimated input tokens. The test catches the missing `disableContinuation` key today (its strict comparison has failed since 1.5.2), but no fixture sets a value, so forwarding is unasserted, and its small inputs never exercise the clamp difference.

## Goals / Non-Goals

**Goals:**

- One invariant for native compaction: the leading system prompt item belongs to the turn or request being sent, never to the checkpoint.
- Wire shapes that match what Pi 1.6.0 and Codex send.
- One Pi host version across the Pi workspace, as the e2e harness requires.

**Non-Goals:**

- Applying prompt replacements to the native compaction request. It was separate before and stays separate (README, "Prompt replacements"). A relay model whose upstream rejects Pi's identity sentence may still fail native compaction, exactly as on 0.6.0.
- Supporting Pi ≤1.5.x: no runtime version check and no dual `instructions` path.
- Changing the output cap Pi 1.6.0 now sends. The user chose to follow Pi; only the README changes.
- Repairing checkpoints already written by 0.6.0 on Pi 1.6.0.
- The thinking-off mapping (`off: "none"`), which GPT-6.2 rejects. It behaves the same on Pi 1.5.0 and 1.6.0, so it is not part of this adaptation, and it is left for a separate change.
- Making the serializer follow Pi's session projection: a compaction older than the latest checkpoint inside the kept range, and `context_edit` entries. That behavior predates this change; see "Risks".
- Relaxing the e2e harness's single-host rule.

## Decisions

### 1. Prompt replacements rewrite the first `input` item, on Codex Responses models only

`applyPromptReplacements` rewrites `payload.input[0].content` when that item is a message (`type` absent or `"message"`) with role `developer` or `system` and string content. It returns a new payload whose `input` is a new array: only that item is replaced, by a copy with new content, and every other item is shared unchanged. The hook runs only when `ctx.model.api === "openai-codex-responses"`. The existing provider, model, and `payload.model` guards stay.

- **Why the API guard:** on Pi 1.6.0 the plain OpenAI Responses adapter also leads `input` with a system item. Without the guard, rules would start rewriting `openai-responses` requests. The README excludes those today (the current spec only ever named the Codex-only `instructions` field). Keeping today's scope is the smallest change.
- **Why only the first item:** it is the system prompt. With sub2api's compat, Pi folds later system messages into it.
- **Rejected alternative: keep rewriting `instructions` as well.** That is a compatibility path the repository rules exclude, and the user chose README-only.

### 2. The serializer separates the lead from the rest; callers never store or match the lead

`serializeMessages` stops passing the removed `includeSystemPrompt` option. It returns the converted items without the lead.

**Lead detection** (mirroring `resolveTranscript` with folding): the first converted item is the lead when it is a `developer` or `system` message and the context passed to the converter contains any system message. The context counts after `normalizeContext` prepends its initial system message for active tools. Every caller works on the rest:

- **Retained-window selection** receives the rest only. The stored window never holds the system prompt, nor a folded update from a turn after an earlier checkpoint. This fixes probe failure A, and the stale-update case reviewers found.
- **Replay prefix** (`rewriteProviderPayload`) matches only the rest of `[compaction entry, ...kept entries]`. The match therefore starts after the turn's own system prompt item, which stays the prompt Pi built for this turn. When the prompt is empty Pi sends no such item, and the match may start at index 0. This fixes failure B, where the budget evicted the prompt so the turn had none. It also fixes failure C, where a folded tool-set change or a forced prompt made the leading item differ, so the prefix never matched.

**Rejected alternative: strip the system item from the window only.** Failure C would remain.

**Rejected alternative: drop system messages before calling the converter.** They carry `toolsAdded`, which the converter uses for tool notices. Removing them could change later items and break the prefix match. Converting the full list and removing the produced lead keeps every other item identical to the host's.

**Effective host overrides.** Pi composes `models.json` model overrides after relay registration. Packed-host probes with `supportsMidConvoSystemMessages` and `supportsMidConvoEffort` independently reproduced stale prompt updates and a missed checkpoint. The folded-lead rule above describes the default, not every effective conversation model. For compaction, serialize newly added history with system messages folded, so the one current lead replaces all transcript prompt text. Do not filter the stored window. For replay, serialize the prefix in the effective turn's mode and match its historical effort updates, excluding the converter's final current-effort item from the prefix. Take that effort from the actual turn's final configuration update, not from a guessed thinking level; leave the live tail intact. Do not insert a synthetic tools-only message before a recorded initial system message in mid-conversation mode.

### 3. Compaction request: Codex's shape, lead from `ctx.getSystemPrompt()`, no guidance

`compactRemotely` stops sending `instructions`. The request `input` is assembled as `[lead, ...body, { type: "compaction_trigger" }]`, the shape of Codex's remote compaction request:

- **`lead`** is `{ role, content: ctx.getSystemPrompt() }`, omitted when that prompt is empty, as Pi omits an empty system item. `role` follows Pi's rule for the conversation model, the same model the serializer uses: `developer` if `model.reasoning && model.compat?.supportsDeveloperRole !== false`, else `system`. A compaction model override does not change it.
  - Taking the text from `ctx.getSystemPrompt()` keeps 0.6.0's source of truth. During a run it includes a prompt forced by an extension. It includes a tool-set change not yet recorded as a system message, and it works for sessions that never recorded a system message.
  - A lead taken from the transcript would differ from the turn's head in all three of those cases.
  - Its limit is the getter's (see "Context"): an idle or run-start compaction carries the base prompt even when an extension will force one on the next turn, and an in-run compaction does not see a tool change made during that run. 0.6.0 had the same limit. Neither affects the checkpoint, which never stores the lead.
- **`body`** is the serialized rest for a first compaction. For a compaction from a checkpoint, it is the stored window followed by the serialized rest after the checkpoint.
- **No guidance.** Custom compaction instructions (Pi's `/compact <text>`, or a programmatic compact; `/openai-compress` passes only its internal marker) are not sent. Codex's remote compaction takes no prompt at all: `run_remote_compact_task` and `run_inline_remote_auto_compact_task` (`codex-rs/core/src/compact_remote_v2.rs:122-175`) have no input parameter, and only Codex's local compaction uses `compact_prompt`. Per the user, OpenAI also advises against guidance in front of server-side compaction. When the instructions are non-blank and are not the command marker, the handler still compacts natively and calls `ctx.ui.notify` once to say that native compaction ignores custom instructions. That is the user's choice, over dropping them silently or falling back to Pi's textual summary, which would replace an active opaque checkpoint.
- `buildV2CompactedWindow` receives `body` only, never the assembled array, so the lead is never stored or replayed.
- `appendCustomInstructions` goes away.

Reasons:

- One copy of the system prompt, placed where Pi's turns and Codex put it.
- Codex's own requests, which Sub2API relays exist to forward, carry no `instructions`. Per Pi #12273, GPT-6.2 appends a top-level `instructions` after `input` anyway.
- The request is exactly the shape Codex sends: base instructions as the leading item, the history, then `compaction_trigger`.

**Rejected alternative: keep 0.6.0's request, with `instructions` holding the prompt plus guidance and no lead in `input`.** It is field-proven, but it diverges from both Pi 1.6.0 and Codex and gives up the shared cache prefix.

**Rejected alternative: send guidance as a message before `compaction_trigger`.** Codex never does this, and OpenAI advises against it.

### 4. All Pi packages move to Pi 1.6.0 together

The harness's single-host rule ties every Pi package's pin to the e2e host, and sub2api's fix needs that host to be 1.6.0. So this change moves every exact `@earendil-works/*` dev pin of all nine Pi packages to `1.6.0` (leaving pi-ask's `npm:` legacy alias), then runs `npm install`. This is what `scripts/e2e/pi/rehearse.ts` does. In the 1.6.0 rehearsal (run `44731323411`), the only failures outside sub2api were pi-custom-provider's drift tests.

The vendored internals in `pi-custom-provider/pi-ai-internal.ts` are re-aligned with pi-ai 1.6.0. `buildBaseOptions` gains `disableContinuation: options?.disableContinuation` in the host's position, `clampMaxTokensToContext` takes 1.6.0's ratio margin, and the header comment names 1.6.0. The drift test gains a fixture that sets `disableContinuation: true`, and a clamp case with an estimated input above 27,306 tokens and a window with room to spare, where the ratio margin exceeds the fixed one. It then checks both. This is a mechanical sync to the pinned host, so it rides in this host-upgrade change rather than an OpenSpec change of its own.

**Planning location and commit.** The workspace pin move is planned here, in sub2api's OpenSpec root, because this package's fix forces it and is the only package whose behavior is specified by it. The other packages change only pins, version lines, and pi-custom-provider's mechanical sync. The commit is repository-wide, so it uses the `repo` scope (`fix(repo): …`), following `740a8a5 fix(repo): align Pi extensions with Pi 1.5.0`.

Release decisions:

- **pi-custom-provider**: `patch`, because published code changes.
- **The other seven**: `none`, because only a development pin and a README version line change. Repository docs (`README.md`, `docs/pi/new-package.md`, `docs/pi/reference.md`) need no release decision.
- **pi-provider-sub2api**: `minor`.

## Risks / Trade-offs

- **[A live relay may reject the new shapes]** The local relay accepts anything. A real relay might reject a compaction request with no `instructions`, or Pi 1.6.0's `max_output_tokens`. The compaction request now has the same shape as Codex's own. If compaction is rejected while a native checkpoint is active, sub2api cancels instead of falling back (README, "Routing behavior"). → Unverified until tried against a real relay. The final report names it as unverified. The prompt placement matches Codex `f342aa7`.
- **[Checkpoints written by 0.6.0 on Pi 1.6.0 keep a stale system prompt copy]** Their stored windows begin with a system-prompt item unless the budget already dropped it (probe B's window holds only the compaction item). Replayed turns send it after the current prompt. Later compactions carry it as a retained message until the 64K budget evicts it or a new session starts. → Accepted under the repository's no-migration rule. It affects only users who ran 0.6.0 on Pi 1.6.0 (released 2026-11-20), and the release note says so.
- **[Lead detection depends on Pi's converter]** If Pi stops emitting the folded system prompt as the first item, the lead is not detected, and the item stays in the body. Turns would then be exposed again to the probe failures B and C, and compaction requests would carry two system items. → The new e2e scenarios pin the shapes, and the daily Pi rehearsal runs them on each new Pi.
- **[Pre-existing: serializer versus Pi's session projection]** The serializer flat-maps entries, while Pi's projection silences a compaction entry older than the latest one and applies `context_edit` entries (`session-manager.js` `buildSessionProjection`, also present in Pi 1.5.0). A replay prefix spanning such entries can fail to match, and the turn falls back to the textual marker. → Not introduced or worsened by this change. It is recorded as a separate follow-up.
- **[Pi ≤1.5.x users who update the plugin lose prompt replacements silently]** → BREAKING note in the README and changelog, and a `minor` bump.
- **[Pinning every Pi package to 1.6.0 does not raise their supported minimum]** Their READMEs' "requires" lines stay unless the package needs 1.6.0. Only "verified/tested against" lines move.
