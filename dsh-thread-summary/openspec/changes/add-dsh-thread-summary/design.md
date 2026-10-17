# Design

## Context

Harness `sessionTitle` owns first-prompt scheduling, deterministic fallback, cancellation, manual-title protection and `session/title` persistence. It permits exactly one provider. The bundle disables the default `session-title-llm` row and registers its replacement using the pinned `@deepseek-ai/dsh-session-title` types.

The review found that the bounded prompt helper was unused, requests had no deadline, explicit refresh used all messages, and package verification did not exercise these paths. The user authorized correcting these issues in the existing change.

## Goals / Non-Goals

**Goals:**

- Keep first-input titles and live summary-model settings compatible with Harness projections and persistence.
- Bound auxiliary input and duration, preserve Unicode, and verify the production call path.
- Preserve deterministic fallback and user renames through the existing host service.

**Non-Goals:**

- Change the main agent model, history, or system prompt.
- Continuously rename conversations or add a custom title event.
- Require provider-specific structured-output support.

## Decisions

1. Register `automatic: "first-prompt"` and explicitly select `request.messages[0]`, including on refresh. Return only that message's seq. Disabled or unconfigured generation fails before any LLM call; the host retains its deterministic fallback. The default LLM provider stays disabled because the service has a single registration slot.
2. Borrow Codex's bounded-input and concise-title policy. Count the system prompt and JSON-framed user text together against a 4,096-byte UTF-8 budget. Truncate the first message at a complete Unicode code point while preserving valid JSON framing. Instruct the model to summarize, not answer, use the user's language, preserve ticket references, and return a single plain-text title.
3. Keep plain-text output because DSH rc.2 `GenerateOptions` exposes no provider-neutral structured-output schema. Normalize with Harness's control-code filtering, remove enclosing quotes and trailing sentence punctuation, and cap the result at 36 Unicode code points and 80 UTF-8 bytes. Reject empty output, tool calls, missing completion and unsuccessful finish reasons. Ignore reasoning blocks. Use 256 output tokens; the display limit is independent of that token budget.
4. Compose the service signal with a 60-second `dsh-timeout` deadline and dispose its timer on every exit. Check cancellation before, during and after streaming. Abort-compliant adapters stop network work; the host rejects stale completions even during manual-rename races. Provider failures propagate to the host's existing error handling; the plugin does not write a separate diagnostic file.
5. Declare exact build/test pins and `*` peers for runtime host imports, including `dsh-session-title` and `dsh-timeout`. Use the real provider contract instead of handwritten replicas. Declare React test-renderer dependencies locally.
6. Retain the General settings slot and `thread-summary` namespace. Discover models via `remote.session.modelCatalog()`. Use a single loaded catalog, revision-aware writes, conflict reload and explicit loading/error/read-only states. Allow saving `enabled: false` without selecting a model. Contain remote failures and rendering failures rather than leaving an unresolved loading state.

7. Match the built-in General row: 16px vertical spacing, a 14px title and 12px secondary description, and an enabled switch aligned to the right. Remove the nested card. Reuse `Button`, `Switch` and `Menu` from the rc.2 shell's `@deepseek-ai/dsh-client-ui-primitives` module table; externalize that import so the plugin shares the host's controls and CSS. Provider/model triggers use native menu keyboard handling, selected marks and portal positioning. Use scoped layout CSS with DSH tokens and a narrow-container stacked layout. Keep a single explicit Save action with loading, success, error and disabled feedback; no backend behavior changes.

## Risks / Trade-offs

- A bounded prefix can omit details late in a long request. The title remains a lightweight summary; preserving all input would defeat the budget.
- Plain text relies on model instruction following. Output validation and normalization enforce the mechanical constraints; malformed or empty results keep the fallback.
- Reasoning-only output or token exhaustion yields fallback rather than accepting an incomplete title.
- Cancellation requires adapter cooperation to stop transport work, matching Harness's built-in deadline contract.

## Verification

Tests must capture actual LLM options and cover oversized ASCII/CJK/emoji/escaped input, first-message attribution on refresh, complete/delta text, error/abort/token exhaustion/tool output, timeout cleanup, live config changes and Unicode normalization. Use real Harness services with a mock LLM to verify title events, fallback and manual rename races. Client render tests cover provider changes, persistence/conflicts, read-only and remote failure states.

The release smoke script checks manifest targets and evaluates the packed browser artifact through the Harness module-loader contract. Pack and install into an isolated directory before running it. Run repository `npm run check`. A real web-profile/real-model check is tracked separately and must never be claimed from mocks.

## Migration Plan

Existing `enabled` and `provider/model` configuration remains valid. Rebuild committed host/browser artifacts; refresh the page for the browser half and restart the Harness for the host half. Record the package's release intent without preparing or publishing a version.
