# Tasks

## 1. Configuration and temporary mode resolution

- [x] 1.1 Add mode types and strict parsing for provider requestModes and modelRequestModes in config.ts/types.ts; verify tests for optional fields, partial inheritance, invalid values/shapes and model keys (reuse isSafeModelId), explicit off states, and same-model/different-provider isolation.
- [x] 1.2 Add a small resolver and per-model temporary overlay; verify tests for Fast/Ultrafast exclusivity, both tiers coexisting with Daybreak, no configuration writes during toggles, model-switch retention, and reload discarding unsaved state. Include any new shipped module in package.json files and verify package typecheck.
- [x] 1.3 Document the fields, precedence, explicit default/standard semantics, and removal-plus-reload to restore inheritance in the package README; verify examples avoid unverified model capabilities (specifically no GPT-5.5 Ultrafast example).

## 2. Explicit saving

- [x] 2.1 Implement serialized raw-JSON read/patch/atomic-replace saves; verify temporary-directory tests preserve credential expressions, unknown settings, unrelated model/provider entries, completed external edits, and restrictive permissions. Cover malformed/missing configuration, missing providers, write failure, temporary-file cleanup, and repeated queued saves without credential execution.
- [x] 2.2 Wire /sub2api-save with no argument or provider only, capturing the selected model and effective snapshot at invocation; verify command tests for both target scopes, empty/partial snapshots, explicit off persistence, invalid arguments/context, accurate success/failure feedback, and saving without changing other temporary overlays. Verify no /save alias or Ctrl+S registration.
- [x] 2.3 Document both save forms, provider-save precedence, reload behavior, JSON reformatting on save, and cross-process last-writer-wins limitations; verify docs match command tests and update the root README package-table description.

## 3. Request, footer, and compaction integration

- [x] 3.1 Replace global tier/program state with resolved selected-model preferences in toggle handlers, request injection, and footer rendering; verify existing request-mode tests plus default wire values, combined modes, preserved access-program fields, unsupported guards, and model-switch footer updates. Replace real-model IDs in affected Ultrafast protocol fixtures with clearly synthetic OpenAI-shaped IDs; verify assertions remain protocol-only. Keep reasoning toggles unchanged.
- [x] 3.2 Pass the conversation model to the compaction tier resolver and preserve command/config/fallback precedence; verify codex-compaction/integration tests cover explicit default, absent tier, compress_model differing from the conversation model, and no Daybreak injection into native compaction.
- [x] 3.3 Update README mode/compaction descriptions and record the implementation release decision per docs/releases.md; verify documented boundaries against integration tests and the release-intent status command. Do not prepare versions or publish.

## 4. Integration verification

- [x] 4.1 Run npm run check from the repository root and the package's RPC load smoke test from docs/workflow.md; verify success and /sub2api-save registration using an isolated fixture configuration without changing the user's settings.
- [x] 4.2 Exercise a live Pi session with an isolated configuration: toggle without saving, switch models, save each scope, reload, and verify modes/footer and untouched unrelated configuration. Use a verified eligible model for any real upstream request; protocol fixtures alone do not establish upstream eligibility. Record exactly what was exercised.
- [x] 4.3 Validate the OpenSpec change with --strict and reconcile artifacts with verified implementation; archive only after implementation and verification are complete.
