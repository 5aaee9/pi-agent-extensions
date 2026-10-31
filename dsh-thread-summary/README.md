# @indexyz/dsh-thread-summary

Generates a concise session title from the first user prompt with a configurable summary model. Requires DSH `0.2.0-rc.2` or later in the `0.2.x` line; builds and tests pin `0.2.2-alpha.2`.

## Install

Install a published version into the profile you use:

```bash
dsh plugin --profile web add @indexyz/dsh-thread-summary
```

For this repository checkout, run from the repository root:

```bash
npm install
npm run build --workspace @indexyz/dsh-thread-summary
dsh plugin --profile web add ./dsh-thread-summary
```

Build output (`lib/` and `client.js`) is Git-ignored. The build above is required before a local `link:` install; `npm pack` builds and includes the output automatically.

Restart the Harness after installing or rebuilding the host half, and refresh the browser after rebuilding the client half. Settings edits themselves are live and need no restart. Releases use the tag `@indexyz/dsh-thread-summary@<version>`.

## Settings and behavior

Open **Settings → General → Summary model** (中文：**设置 → 通用设置 → 摘要模型**). Choose a Provider and Model, leave **Generate session titles** enabled, and save. The profile stores `enabled` and the combined `provider/model` route under the `thread-summary` settings namespace. Existing routes remain compatible, including model IDs containing `/`.

A new root session's first eligible human text starts one auxiliary request once the main request header is available. Its configured summary model is independent of the conversation model. The plugin also uses only the first message when the host explicitly refreshes a title. Creating an empty session does not call a model, and subsequent prompts do not automatically rename it.

The auxiliary call has these bounds:

- System instructions and JSON-framed user input together occupy at most 4,096 UTF-8 bytes. Long input is truncated at a complete Unicode code point while retaining valid JSON.
- Generation has a 60-second deadline and a 256-token output budget. It sends no tools and does not change the main agent's history or instructions.
- Titles use the user's language and are limited to 36 Unicode code points and 80 UTF-8 bytes. Controls, enclosing quotes, extra whitespace and trailing sentence punctuation are removed. Reasoning blocks never appear in the title.

Failed, timed-out, cancelled, incomplete, token-limited, tool-call or empty responses retain Harness's deterministic first-input fallback. This fallback extracts text; it does not call another model. The bundle replaces Harness's default model title provider because the host allows only one registered provider. Disabling this plugin's generation, or leaving its model unconfigured, therefore keeps deterministic titles. You can save the disabled setting without choosing a model.

The host persists successful titles using its standard `session/title` event, updates title projections, and preserves titles during replay. Manual renames cancel pending automatic work and cannot be overwritten by a late summary response.

The settings row reuses DSH's built-in `Button`, `Switch` and `Menu` components through the browser module table. It follows General settings typography and spacing, adapts to light/dark themes, and stacks the model fields in narrow containers. Selectors inherit the host's keyboard navigation, selected marks and focus return. Loading, read-only, remote failure and revision-conflict states are shown inline. A conflict reloads the current saved values for review before the next save. Existing configured routes remain visible even if temporarily absent from the model catalog.

## Development and verification

```bash
npm run check --workspace @indexyz/dsh-thread-summary
npm run check
node dsh-thread-summary/test/smoke-release.ts dsh-thread-summary
```

Tests run the real pinned host: the title provider streams through the real `LlmRuntime` and `@deepseek-ai/dsh-llm-pi-ai` adapter from a locally started OpenAI-compatible endpoint (stream assembly, finish handling, deadlines, cancellation, Unicode bounds), next to the real Cordis/session/title/projection services. The settings row is driven in real Chromium against a `dsh web` server booted from the pinned host CLI over a throwaway profile, with the host's own `llm-pi-ai` adapter supplying the model catalog from that local endpoint; the browser tests need `npx playwright install chromium` once and a fresh `npm run build`, and fail rather than test stale artifacts. The release smoke script runs the same web plane against the packed and installed package after validating its manifest targets.

Real-model validation is separate: in the chosen web profile, save a summary model, send a first input in a new session, confirm the title changes, and repeat with a manual rename while generation is pending. The local endpoint does not certify a real provider's network access or behaviour.

The bounded prompt and title policy takes inspiration from [Codex's thread title implementation](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/tui/src/app/thread_title.rs). This plugin uses DSH's provider-neutral plain-text interface because rc.2 does not expose a structured-output schema in `GenerateOptions`.
