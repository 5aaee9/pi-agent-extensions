# Proposal

## Why

The local `@juicesharp/rpiv-todo` extension is a major contributor to large Pi session files: representative Ares sessions are 1.19–1.25 GB, with `rpiv-todo-state` custom entries and `todo` tool results accounting for 68–77% of the file. Each persisted result repeats the complete task list, and normal calls currently duplicate the same snapshot in both a custom entry and a tool result.

This change creates a repository-owned `@indexyz/pi-todo` fork so the persistence format can be optimized without waiting for an upstream release, while retaining compatibility with existing Pi sessions and the existing todo runtime identities.

## What Changes

- Add a repository-owned `pi-todo` package forked from the locally installed todo extension, including its tool, `/todos` command, overlay, configuration, localization fallback, and state management.
- Preserve the runtime identities `todo`, `todos`, and `rpiv-todo-state` so existing permissions and session history remain usable.
- Replace newly persisted full task snapshots with compact operation records containing the action and parameters needed to replay the mutation.
- Persist compact operation records for both `toolResult.details` and the custom entry used by nested `ctx.executeTool` calls, eliminating the duplicate full snapshots while retaining nested-call recovery.
- Replay compact records in order and continue to read legacy full snapshots from existing sessions; malformed records must be ignored without discarding the last valid state.
- Add regression tests covering direct and nested-call replay, legacy snapshot compatibility, no-op/read operations, and the compact serialized shape.
- Register the new package in the workspace, package-level Pi configuration, Pi E2E registrations, documentation, and release decision.

## Capabilities

### New Capabilities

- `todo-task-management`: Repository-owned todo tool, command, overlay, state lifecycle, and backward-compatible compact session persistence.

### Modified Capabilities

- None; this package has no existing repository-owned capability specification.

## Impact

- Affected package: new `pi-todo/` package and its OpenSpec artifacts.
- Affected repository wiring: root workspace and Pi extension registration, Pi E2E package registration, root package documentation, and a release intent for `@indexyz/pi-todo`.
- Affected runtime behavior: the in-memory tool result remains a complete task-state result for rendering and callers, while its JSON-persisted representation becomes an operation record. Existing sessions with legacy `tasks`/`nextId` snapshots remain readable.
- No Pi host API or unrelated dsh package changes are required.
