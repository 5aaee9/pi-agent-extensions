# Tasks

## 1. Move every Pi package to Pi 1.6.0

- [x] 1.1 Set every exact `@earendil-works/*` dev dependency of the nine `pi-*/package.json` files to `1.6.0`: pi-ask, pi-autocompact, pi-continue, pi-custom-provider, pi-idle-compression, pi-model-trace, pi-provider-sub2api, pi-skill, pi-todo. Leave pi-ask's `npm:` legacy alias unchanged. Then run `npm install` from the repository root. Verify:
  - `node -e 'import("./scripts/e2e/pi/world.ts").then(w => console.log(w.piHost().version))'` prints `1.6.0`.
  - `git diff package-lock.json` changes only the Pi packages and Pi 1.6.0's own transitive dependency graph, with no unrelated manifest pins.
- [x] 1.2 Re-align `pi-custom-provider/pi-ai-internal.ts` with pi-ai 1.6.0's `simple-options.js`:
  - `buildBaseOptions` forwards `disableContinuation: options?.disableContinuation` in the host's position.
  - `clampMaxTokensToContext` takes the 15% input safety margin, and its 32,768-token threshold below which the fixed 4,096-token margin is restored.
  - The header comment names 1.6.0.

  First extend `test/vendored-drift.test.ts`: set `disableContinuation: true` in the "every forwarded option" fixture, and add a dedicated `clampMaxTokensToContext` case in which the ratio applies: a context estimated above 27,306 tokens, a window leaving more than 32,768 tokens of room beyond the margin, and a requested output above that room. Example: 40,000 input, 200,000 window, 160,000 requested gives 155,904 before the edit and 154,000 after. Verify both the `disableContinuation` case and the clamp case fail before the edit and `npm run check --workspace @indexyz/pi-custom-provider` passes after it.

- [x] 1.3 Move each "verified/tested against Pi 1.5.0" README line to Pi 1.6.0, leaving every "requires Pi … or newer" line as it is:
  - `pi-continue/README.md:43`
  - `pi-skill/README.md:63`
  - `pi-ask/README.md:17` (keep its OSC fallback note on Pi 1.4.0)
  - `pi-todo/README.md:3`

  Also update the repository-level baseline statements: `README.md:7` ("All nine Pi packages are verified against Pi 1.5.0"), `docs/pi/new-package.md:73` (template pin) and `:90` (the shared version it names), and `docs/pi/reference.md:45` (the version named for the extension types path, after checking the path still holds in 1.6.0). Verify with `npx oxfmt --check` on those files.

- [x] 1.4 Record release decisions:
  - `npm run change -- --patch @indexyz/pi-custom-provider -m "<summary: Ollama requests forward disableContinuation and clamp output tokens with Pi 1.6.0's input safety margin>"`.
  - One hand-written `none` intent file each for `@indexyz/pi-ask`, `@indexyz/pi-autocompact`, `@indexyz/pi-continue`, `@indexyz/pi-idle-compression`, `@indexyz/pi-model-trace`, `@indexyz/pi-skill`, `@indexyz/pi-todo`. Reason: development pin and README version line only; nothing ships.

  Verify each file exists in `.changeset/` and names exactly one package. `change:status` does not list `none` intents; the release gate checks them in the follow-up.

- [x] 1.5 Run `npm run check --workspace @indexyz/<name>` for each Pi package other than pi-provider-sub2api. Verify all pass on Pi 1.6.0. sub2api's typecheck is fixed in group 3.

## 2. Prompt replacements on the system prompt item

- [x] 2.1 Rewrite `scripts/e2e/pi/pi-provider-sub2api-prompt-replacements.e2e.ts` to read the system prompt from the first `input` item (role `developer` or `system`, string content) instead of `instructions`. Keep its four model and provider cases. Add:
  - One model with `supported_reasoning_levels`, so both the `developer` and `system` roles are exercised.
  - A user prompt containing the `from` text, asserted unchanged in its own item.
  - An assertion that the body has no `instructions`.

  Verify it fails on the current code with Pi 1.6.0 (the identity sentence is still present): `node --test scripts/e2e/pi/pi-provider-sub2api-prompt-replacements.e2e.ts`.

- [x] 2.2 Change `applyPromptReplacements` in `prompt-replacements.ts` to rewrite only the first `input` item's string content, for `openai-codex-responses` models only. Return a new payload and `input` array that share every other item. Remove the `instructions` path. Verify the 2.1 scenario passes.
- [x] 2.3 Rework `test/prompt-replacements.test.ts` fixtures to the Pi 1.6.0 shape (`input: [{ role: "developer", content }, ...]`). Cover the spec delta's cases:
  - A first item that is a user message.
  - Non-string content.
  - A top-level `instructions` string left untouched.
  - A later `developer` item left untouched.
  - A `system`-role lead.
  - A non-Codex model API left unchanged.

  Verify `npm run test --workspace @indexyz/pi-provider-sub2api` passes.

- [x] 2.4 Update `pi-provider-sub2api/README.md`, "Prompt replacements": the field description, the rules paragraph, and the paragraph naming the field and the APIs a rule changes. Describe the leading `developer`/`system` input item on Codex Responses models, Pi 1.6.0 or newer. Also edit the Purpose line of `openspec/specs/prompt-replacements/spec.md` ("outgoing instructions" → "outgoing system prompt"). Verify with `npx oxfmt --check` on both files.

## 3. Native compaction keeps the system prompt out of the checkpoint

- [x] 3.1 Add failing-first scenarios to a new `scripts/e2e/pi/pi-provider-sub2api-compaction-system-prompt.e2e.ts`, each naming the failure it guards:
  - (a) The stored window holds no system-prompt item.
  - (b) A newest user message over the 64K retention budget still leaves the next turn with the current system prompt first, then the compaction item.
  - (c) After an extension removes a tool with `pi.setActiveTools` following a native checkpoint, the next turn replays the compaction item, not the textual marker, and its first item reflects the new tool set.
  - (d) With a test extension whose `before_agent_start` returns a `systemPrompt`:
    - Turns after a checkpoint replay the compaction item and carry the forced prompt first.
    - An in-run compaction (context-overflow recovery, driven as in `pi-provider-sub2api-retry.e2e.ts`) carries the forced prompt as its first item.
    - An idle `/openai-compress` carries the base prompt as its first item and has no `instructions` field.
  - (e) A first compaction and a compaction from a checkpoint each send the system prompt once, as the first item, with no `instructions`.
  - (f) Checkpoint, one turn, tool-set change, another turn, second compaction. The second request's first item reflects the new tool set (the removed tool is absent), no other item carries the system prompt or the change, and the new stored window has none.
  - (g) `compact` with custom instructions `FOCUS-GUIDANCE` still compacts natively. Its request ends with the conversation followed by `compaction_trigger`, no part of it contains the text, and a notice says native compaction ignores custom instructions. Whitespace-only instructions and `/openai-compress` show no notice.

  Verify each scenario fails on the current code with Pi 1.6.0: `node --test "scripts/e2e/pi/pi-provider-sub2api-compaction-system-prompt.e2e.ts"`. A case that already holds today, such as the idle base prompt in (d), shares a scenario with a failing assertion. The throwaway probes already observed (a), (b) and (c) failing.

- [x] 3.2 In `codex-compaction.ts`, remove the `includeSystemPrompt` option. Make the serializer drop the lead: the first converted item, when it is a `developer`/`system` message and the normalized context contains any system message. Verify `npm run typecheck --workspace @indexyz/pi-provider-sub2api` passes.
- [x] 3.3 Use only the serializer's rest for retained-window selection and for the replay prefix in `rewriteProviderPayload`, so a turn's own system prompt item, when it has one, is never replaced. When the prompt is empty Pi sends no such item, and the match may start at index 0. Verify scenarios 3.1 (a), (b), (c), (d replay) and (f window) pass.
- [x] 3.4 Assemble the compaction request `input` as `[lead, ...body, compaction_trigger]`:
  - `lead` is `{ role, content: ctx.getSystemPrompt() }`, omitted when the prompt is empty. `role` comes from Pi's rule applied to the conversation model, not a compaction model override (`developer` if `model.reasoning && model.compat?.supportsDeveloperRole !== false`, else `system`).
  - `body` is the serialized rest, or the stored window plus the rest after the checkpoint.
  - Custom instructions are never sent. For non-blank instructions that are not the `/openai-compress` marker, call `ctx.ui.notify` once to say native compaction ignores them, and continue.

  Pass `body` alone to `buildV2CompactedWindow`. Drop `instructions` and `appendCustomInstructions`. Verify scenarios 3.1 (d compaction), (e), (f request) and (g) pass.

- [x] 3.5 Run every existing sub2api compaction scenario on Pi 1.6.0 and verify they pass without weakening any assertion:
  - `pi-provider-sub2api-compaction.e2e.ts`
  - `-compaction-failures.e2e.ts`
  - `-compress.e2e.ts`
  - `-retry.e2e.ts`
  - `-xai-session.e2e.ts`
- [x] 3.6 Update `pi-provider-sub2api/README.md`, "Routing behavior": the Remote Compaction V2 paragraph should say the request leads `input` with the system prompt, ends with `compaction_trigger`, and sends no `instructions`, as Codex does. Also say that custom instructions (`/compact <text>`) are ignored by native compaction, with a notice. Also note that a checkpoint written by 0.6.0 on Pi 1.6.0 keeps a stale system prompt copy, if its window retained one, until the budget evicts it or a new session starts. Update the "Native compaction falls back" troubleshooting item if it names `instructions`. Verify with `npx oxfmt --check pi-provider-sub2api/README.md`.

## 4. Remaining sub2api documentation and release decision

- [x] 4.1 Update `pi-provider-sub2api/README.md`:
  - "Requirements": Pi 1.6.0 or newer, with the BREAKING note that prompt replacements no longer apply on older Pi.
  - "Routing behavior": the paragraph listing `instructions` in the Codex request shape.
  - The xAI notes at lines 124 and 143, so they do not read as a lower minimum. Also make the runtime messages in `index.ts:113` and `xai-stream.ts:81` name Pi 1.6.0.
  - "Development": "Verified against Pi 1.6.0".
  - Next to the OpenAI output-limit notes in "Model discovery"/"Additional behavior": Pi 1.6.0 sends `max_output_tokens` on Codex turns. It derives the value from the registered limit (relay, then catalog, otherwise `min(16384, context window)`, or 8,192 for Haiku 4.5), clamps it per turn to the context room left, and floors it at 16.

  Verify with `npx oxfmt --check pi-provider-sub2api/README.md`. The two runtime strings sit on a branch that Pi 1.6.0 never reaches (the Responses adapter is present), so they are only compile-checked by task 5.1. Their text is the one this task specifies.

- [x] 4.2 Fix the stale comment above `usedCodexAdapter` in `scripts/e2e/pi/pi-provider-sub2api-reload.e2e.ts`, which mentions top-level instructions. Verify the reload scenarios still pass.
- [x] 4.3 Record the release decision: `npm run change -- --minor @indexyz/pi-provider-sub2api -m "<summary>"`. The user-facing summary covers:
  - The Pi 1.6.0 requirement.
  - Prompt replacements now edit the system prompt item.
  - The native compaction fixes (system prompt kept, replay after prompt changes, one copy in the compaction request).
  - Native compaction no longer sends `/compact <text>` instructions and shows a notice instead, matching Codex.
  - A checkpoint written by 0.6.0 on Pi 1.6.0 keeps a stale system prompt copy, if its window retained one, until the retention budget evicts it or a new session starts.

  Verify `npm run change:status` shows a minor bump for `@indexyz/pi-provider-sub2api` and a patch for `@indexyz/pi-custom-provider`.

## 5. Verification

- [x] 5.1 Run the per-package verification from the repository root, for each Pi package changed in group 1 and for pi-provider-sub2api. Verify each exits 0:
  - `npx oxfmt --check <name> .changeset`
  - `npx oxlint --deny-warnings <name>`
  - `npm run check --workspace @indexyz/<name>`
  - `npm run test:e2e -- --package @indexyz/<name>`

  The loop forms in `docs/workflow.md`, "Verify", cover all Pi packages.

- [x] 5.2 Run the Pi-only root tooling checks, because `scripts/e2e/pi/` changed. Verify each exits 0:
  - `npx oxfmt --check scripts/e2e/pi`
  - `npx tsc -p tsconfig.json`
  - `npm run lint:tooling`
  - `npm run test:e2e:pi`, which includes `harness.e2e.ts`'s single-host check on Pi 1.6.0
- [x] 5.3 In the final report, name what stays unverified without a live relay:
  - Whether a real Sub2API relay accepts a compaction request with no `instructions` (the shape Codex sends).
  - Whether it accepts Pi 1.6.0's `max_output_tokens`.

## 6. Effective Pi model overrides

- [x] 6.1 Exercise both confirmed override failures through packed Pi and local relay. Fix native compaction/replay for mid-conversation system and effort updates; verify the request, persisted window, opaque replay and current effort.
- [x] 6.2 Re-run Pi workspace and host checks on the corrected implementation, then submit it for multi-agent re-review.

## Workflow follow-up

- Archive the change with `openspec-archive-change`. This syncs `specs/native-compaction/` and the `prompt-replacements` and `xai-relay` deltas into `openspec/specs/`.
- Commit on a branch as one repository-wide commit, `fix(repo): align Pi packages with Pi 1.6.0`, following `740a8a5`. Then run `npm run release:gate -- --base origin/main --head HEAD`, and verify it passes with the nine intents.
- Report separately for a later change:
  - The thinking-off mapping: `off: "none"` is rejected by GPT-6.2, on any Pi version.
  - The serializer-versus-projection replay gap for older compactions and `context_edit` entries.
- Preparing and publishing the release needs its own explicit request (`docs/releases.md`).
