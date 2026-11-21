# Proposal

## Why

Pi 1.6.0 moved the Codex system prompt out of the top-level `instructions` field and into a leading `developer` or `system` item in `input` (Pi #12273: on GPT-6.2 the backend appends `instructions` after `input`, so the system prompt was never served from the prompt cache). It also removed the serializer option sub2api used to keep that prompt out of its own native-compaction input. On Pi 1.6.0, sub2api 0.6.0 fails its typecheck. Running Pi 1.6.0 against a local relay shows three user-facing failures that do not occur on Pi 1.5.0:

- **Prompt replacements do nothing.** The request has no `instructions` string, so rules such as the Antigravity identity rewrite leave the system prompt untouched. The probe showed the identity sentence reaching the relay unchanged, so an upstream that rejects that sentence, which is what the rule exists for, rejects the request again.
- **A native compaction checkpoint can drop the system prompt from every later turn.** The stored replay window now keeps a frozen copy of the system prompt as its oldest retained message. When the 64K retention budget drops that copy, the replayed request carries no system prompt at all.
- **A checkpoint stops replaying after the system prompt changes.** Two triggers: the active tool set changes after compaction, or an extension forces the prompt (as `pi-ask` does on every turn). In both cases the prefix match fails, and the turn sends the textual checkpoint marker instead of the compaction item, so the model loses the compacted history.

The native compaction request also sends the system prompt twice: in `instructions` and again in the leading input item.

The repository's Pi end-to-end suite requires every Pi package to pin the host version it runs (`scripts/e2e/pi/harness.e2e.ts`), so sub2api cannot move to Pi 1.6.0 alone.

## What Changes

- **BREAKING**: sub2api requires Pi 1.6.0 or newer.
  - Prompt replacements rewrite the system prompt where Pi 1.6.0 sends it: the leading `developer` or `system` item of a Codex Responses request.
  - The top-level `instructions` path is removed, so rules no longer apply on Pi 1.5.x or older.
  - The README states the requirement. The peer range stays `*` per repository conventions, and no runtime version check is added.
- **Native compaction keeps the system prompt out of the checkpoint.** The system prompt stays out of the stored window and out of the prefix matched for replay. A replayed turn keeps the system prompt Pi built for it, whatever the retention budget kept and whatever changed in that prompt since the checkpoint.
- **The native compaction request carries the system prompt exactly once, as the leading input item.** This matches Pi 1.6.0's turns and current Codex, whose request type has no `instructions` field.
  - The text is Pi's current system prompt: the running turn's prompt, including one an extension forces, or the base prompt with the current tools when no turn is running (as 0.6.0's `instructions` was). The item is omitted when the prompt is empty.
  - The request is built like Codex's remote compaction: system prompt, conversation, `compaction_trigger`, and nothing else.
  - Custom compaction instructions are no longer sent. Codex's remote compaction takes no prompt, and OpenAI advises against guidance before server-side compaction. Pi's `/compact <text>` still compacts natively and shows a notice that the text was ignored. 0.6.0 appended the text to `instructions`.
- **Honor effective Pi model overrides during compaction.** With `supportsMidConvoSystemMessages`, exclude transcript prompt updates from the newly serialized compaction body without changing old windows. With `supportsMidConvoEffort`, match historical effort updates while preserving the live turn’s effort.
- **Every Pi package moves its `@earendil-works/*` dev pins to 1.6.0 together**: pi-ask, pi-autocompact, pi-continue, pi-custom-provider, pi-idle-compression, pi-model-trace, pi-provider-sub2api, pi-skill, and pi-todo.
  - pi-ask's `npm:` legacy alias stays as it is.
  - Each package's "verified/tested against" README line moves to Pi 1.6.0, as do the repository README's shared baseline line and the new-package template's pin.
- **pi-custom-provider's vendored pi-ai internals are re-aligned with Pi 1.6.0.** `buildBaseOptions` forwards `disableContinuation` (pi-ai since 1.5.2), and `clampMaxTokensToContext` keeps Pi 1.6.0's 15% input safety margin. Its drift test against the pinned host has been red since 1.5.2.
- Unchanged: Pi 1.6.0 now sends `max_output_tokens` on Codex turns. sub2api follows Pi and does not suppress it. The README explains where the value comes from:
  - The model's registered limit (relay, then catalog, otherwise sub2api's fallback of 16,384, or 8,192 for Haiku 4.5, capped to the context window).
  - Pi clamps it per turn to the context room left and floors it at 16.

## Capabilities

### New Capabilities

- `native-compaction`: how the relay's native Codex compaction carries the system prompt in its request, its stored checkpoint, and replay. This covers only the system-prompt contract this change fixes, not the whole compaction feature, which has no spec yet.

### Modified Capabilities

- `prompt-replacements`: rules rewrite the leading system-prompt input item of a Codex Responses request instead of the top-level `instructions` string. The requirements about which field is rewritten, which fields stay unchanged, and when a request is left alone change accordingly.
- `xai-relay`: the "Supported Pi baseline" requirement moves from Pi 1.4.0 to Pi 1.6.0, the version the package now requires and is accepted on. The "xAI metadata resolution" bundled-catalog scenario stops naming Pi 1.4.0 and refers to the pinned host's catalog.

## Impact

- **sub2api code**: `prompt-replacements.ts`, `codex-compaction.ts` (serializer options, lead detection, retained-window selection, replay prefix, compaction request body).
- **sub2api runtime messages**: the two "Pi 1.4.0 or newer" xAI adapter messages (`index.ts`, `xai-stream.ts`) name Pi 1.6.0.
- **Other package code**: `pi-custom-provider/pi-ai-internal.ts` (`buildBaseOptions`, `clampMaxTokensToContext`, header comment).
- **Tests**:
  - `pi-provider-sub2api/test/prompt-replacements.test.ts` (payload fixtures).
  - `scripts/e2e/pi/pi-provider-sub2api-prompt-replacements.e2e.ts`.
  - New native-compaction scenarios under `scripts/e2e/pi/`.
  - A stale comment in `pi-provider-sub2api-reload.e2e.ts`.
  - pi-custom-provider's existing `test/vendored-drift.test.ts` goes green again, with a fixture that sets `disableContinuation` and a clamp case whose input is large enough for the ratio margin to apply.
- **Manifests and lockfile**: all nine `pi-*/package.json` files, and `package-lock.json`. The lockfile also picks up Pi 1.6.0's transitive dependency updates.
- **Docs**:
  - `pi-provider-sub2api/README.md`: requirements, prompt replacements, routing and request shape, output cap, troubleshooting, xAI version notes, "Verified against".
  - The "verified/tested against" line in the READMEs of pi-ask, pi-continue, pi-skill, and pi-todo.
  - Repository `README.md` (shared Pi baseline line), `docs/pi/new-package.md` (template pin and baseline sentence), `docs/pi/reference.md` (version named for the extension types path).
  - `openspec/specs/prompt-replacements/spec.md` Purpose line, which still says "outgoing instructions".
- **Releases**:
  - `minor` for `@indexyz/pi-provider-sub2api` (breaking for Pi ≤1.5.x users; pre-1.0).
  - `patch` for `@indexyz/pi-custom-provider` (vendored internals re-aligned with Pi 1.6.0).
  - `none` for the other seven packages (development pin and README version line only).
- **Users**:
  - A checkpoint written by 0.6.0 on Pi 1.6.0 may hold a copy of the system prompt in its window (unless the retention budget already dropped it). After this change that copy is replayed after the current system prompt, and later compactions keep carrying it until the retention budget evicts it or a new session starts.
  - Checkpoints written on Pi 1.5.x hold no such copy and replay unchanged.
