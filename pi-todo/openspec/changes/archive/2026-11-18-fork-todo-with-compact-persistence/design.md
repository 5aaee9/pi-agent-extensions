# Design

## Context

The fork starts from the locally installed `@juicesharp/rpiv-todo` source. Its current `TaskDetails` object includes the entire task array and `nextId` for every tool result; state-changing calls also append that same snapshot as a custom session entry. Pi serializes both objects into the session branch. The fork must keep the established runtime names and state lifecycle while changing only the newly serialized persistence payload.

See `proposal.md` for the measured Ares-session impact and `specs/todo-task-management/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Ship a self-contained repository package named `@indexyz/pi-todo` with the existing todo UI and tool behavior.
- Make new tool-result and custom-entry details small and replayable by storing action parameters instead of cumulative snapshots.
- Replay both the new operation records and legacy snapshot records, including branches that mix both formats.
- Prevent a direct call's matching custom record and tool result from applying the same mutation twice.
- Keep the runtime tool result useful to the live extension while keeping its JSON representation compact.

**Non-Goals:**

- Do not rewrite or migrate existing session files in place.
- Do not change Pi's session manager, compaction algorithm, or unrelated extensions.
- Do not rename the `todo` tool, `/todos` command, `rpiv-todo-state` entry type, task statuses, or overlay key.
- Do not remove nested-call persistence; the custom entry remains necessary when `ctx.executeTool` does not produce a standalone tool result.

## Decisions

### 1. Fork the installed extension with package-local source

Copy the installed extension's TypeScript modules into `pi-todo/`, adapt package metadata and documentation to `@indexyz/pi-todo`, and preserve the source module boundaries. Keep the existing optional localization/configuration integrations rather than rewriting unrelated UI behavior. This limits the fork's behavioral surface to the persistence change and makes future upstream comparisons straightforward.

Alternative considered: depend directly on `@juicesharp/rpiv-todo` and wrap its registration. Rejected because the persistence payload is constructed inside the dependency and cannot be changed without another fork or runtime monkey patch.

### 2. Use action-and-parameters records as the new persistence format

The tool result builder will expose the action and input parameters as the enumerable serialized fields. The complete live state can remain available to the running extension through non-enumerable compatibility properties on the returned details object, while `JSON.stringify` omits the cumulative `tasks` and `nextId` fields. The custom entry receives the same compact object.

This keeps a caller that reads the immediate result's `details.tasks`/`details.nextId` working without writing those fields to disk. The persistence discriminator is structural: a legacy record has a valid `tasks` array and `nextId`; a compact record has a valid action and parameter object but no snapshot fields.

Alternative considered: store only a hash or an opaque state id. Rejected because a session replay must be self-contained and cannot depend on an external state store.

### 3. Replay records through the existing pure reducer

Replay will process records in chronological branch order. Legacy snapshot records replace the reconstructed state; compact records pass their action and parameters through the same task reducer used by live execution. Read-only and invalid operations leave state unchanged. Validation will reject malformed records before reducer invocation.

Alternative considered: add a second replay-only mutation interpreter. Rejected because it would duplicate transition, dependency, and metadata rules and could diverge from live behavior.

### 4. Treat valid custom records as the authoritative mutation stream

The replay pass will collect valid custom todo records and valid todo tool-result records separately. Tool-result records preceding the first valid custom record provide the base for older sessions. From the first valid custom record onward, replay follows the custom stream and ignores subsequent tool-result records. This preserves the current custom-entry precedence, prevents direct calls from applying twice, and still allows old sessions or hosts that lack custom entries to replay from tool results.

A custom record can be either a legacy snapshot or a compact operation, so upgrades and branch forks can contain mixed formats safely.

### 5. Test persistence at the serialization boundary

Unit tests will call the pure result builder and replay function with hand-built branch entries. They will assert both immediate details access and `JSON.stringify` output, then cover direct/custom deduplication, nested-only custom records, legacy snapshots, mixed records, malformed records, and all state-changing actions. Pi-dependent registration behavior will be covered by the package's host-level E2E registration.

## Risks / Trade-offs

- **[Risk]** Non-enumerable compatibility fields may be lost if a host clones details before returning them. → **Mitigation:** the live extension itself uses the reducer state, and tests exercise the exact host-facing result object; the persisted contract does not depend on those fields.
- **[Risk]** Replaying a long operation stream costs more CPU than loading one snapshot. → **Mitigation:** operations are small, replay already scans the whole branch, and legacy snapshots remain supported; measure the package tests before considering checkpointing.
- **[Risk]** A malformed compact record could otherwise reset state or throw during lifecycle replay. → **Mitigation:** validate action and parameter shape, skip invalid records, and retain the last valid state.
- **[Risk]** Upstream changes to the installed extension may not automatically reach the fork. → **Mitigation:** document the fork origin and keep the copied modules structurally aligned so later synchronization is reviewable.

## Migration Plan

1. Install the repository package in place of `@juicesharp/rpiv-todo` for new sessions while keeping the runtime identifiers unchanged.
2. On `session_start`, compaction, or tree replay, read old full snapshots and new compact records using the same replay path; no session-file migration is needed.
3. Do not assume upstream will read mutations written by the fork: older upstream versions recognize only full snapshots. Existing session files are not rewritten.
