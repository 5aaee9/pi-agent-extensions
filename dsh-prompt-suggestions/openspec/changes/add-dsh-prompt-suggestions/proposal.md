# Proposal

## Why

After a successful reply the user usually knows the next step, but the empty composer still requires typing it out. Codex and Claude Code show a dim next-message suggestion in that empty composer, letting the user accept a likely follow-up with one key. DeepSeek Harness has no equivalent, and its composer has no decoration slot for a second placeholder.

## What Changes

- Add `dsh-prompt-suggestions/`, published as `@indexyz/dsh-prompt-suggestions`, with a Host half and a browser half.
- Generate exactly one ephemeral suggestion after each eligible live turn: the turn must end with `completed`, contain direct human text and visible assistant text, and the session must have been watched by an open composer. Failed, aborted, interrupted, replayed, restored, text-free, and replayed turns never trigger generation.
- Reuse the conversation's current provider/model and request the lowest available reasoning effort. Send at most the eight most recent visible user/assistant exchanges, bounded to 4,096 UTF-8 bytes. The auxiliary call is tool-free, has no hooks/connectors/environment access/goal inheritance, appends no session events, and has a 30-second deadline.
- Serve the in-memory result over an authenticated Connection Fetch route so the browser half needs no bundle dependency on the connection package.
- Render the result as dim ghost text in an empty composer. Tab or Right Arrow appends it to the draft through the public composer actions and never submits. Escape dismisses it; typing, pasting, existing drafts, attachments, open menus, and custom Tab/Right-Arrow bindings take priority.
- Add a Settings → General switch for the global enabled state, persisted through the Host settings service with revision checking and read-only/conflict handling.
- Add OpenSpec capability specs, focused Host/Client tests, a release smoke check that evaluates the packed browser artifact, documentation, a release intent, and the workspace/README entries.

## Capabilities

### New Capabilities

- `prompt-suggestion-generation`: Host scheduling, current-route reuse, bounded recent history, low reasoning, deadline, cancellation, output validation, and ephemeral state.
- `prompt-suggestion-composer`: ghost-text rendering, acceptance/dismissal keys, priority rules, no auto-submit, and theme repainting.
- `prompt-suggestion-settings`: the General settings switch, namespace persistence, revision conflicts, read-only behavior, and localization.
- `prompt-suggestion-package`: dsh manifest/build/publish shape, Connection route, release smoke verification, and documentation.

### Modified Capabilities

None; this is a new package.

## Impact

- New `dsh-prompt-suggestions/` package, workspace entry, root README row, OpenSpec change, and release intent.
- Runtime dependencies on Harness `llm`, `sessions`, optional `connection`, browser `slots`, `locale`, `remote.settings`, `connection`, and optional `shortcuts` services. No existing session event model or main conversation behavior changes.
- Each eligible live reply adds one auxiliary model request; a composer that has never been open for a session does not generate. The suggestion is intentionally not persisted, so a page reload drops it.
