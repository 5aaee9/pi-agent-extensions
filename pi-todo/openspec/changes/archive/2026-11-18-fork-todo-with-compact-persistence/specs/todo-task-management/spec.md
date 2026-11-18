# Spec Delta

## Purpose

Provides a repository-owned Pi todo extension whose task-management behavior remains compatible with existing sessions while its persisted records avoid repeatedly embedding the complete task list.

## ADDED Requirements

### Requirement: Preserve the todo task-management surface

The extension SHALL provide the existing `todo` tool, `/todos` command, and interactive task overlay with the existing task actions, statuses, and runtime identifiers.

#### Scenario: Existing todo action remains usable

- **WHEN** an agent invokes `todo` with a supported action
- **THEN** the extension returns the same task mutation or query behavior and user-facing result shape as the forked extension

#### Scenario: Existing session identity remains recognized

- **WHEN** Pi loads the extension alongside a session containing `todo`, `todos`, or `rpiv-todo-state` records
- **THEN** those records remain associated with the todo extension rather than being treated as unknown plugin data

### Requirement: Persist compact todo operation records

The extension SHALL persist the action inputs needed to replay each todo call without embedding the cumulative task list and full next-id snapshot in every new record.

#### Scenario: State mutation is persisted compactly

- **WHEN** a todo call changes task state
- **THEN** its newly serialized persistence records contain the mutation action and parameters and do not contain a repeated full task array

#### Scenario: Read-only call is persisted without a state snapshot

- **WHEN** a todo `list`, `get`, invalid, or no-op call produces a tool result
- **THEN** its newly serialized details do not contain a cumulative full task-state snapshot

### Requirement: Replay compact and legacy records

The extension SHALL reconstruct task state in branch order from compact operation records and SHALL continue to replay legacy records that contain complete `tasks` and `nextId` snapshots.

#### Scenario: New compact branch replays

- **WHEN** a session branch contains compact todo records for a sequence of valid mutations
- **THEN** replay reconstructs the same task list and next id that the live tool state had after that sequence

#### Scenario: Legacy snapshot branch replays

- **WHEN** a session branch contains only legacy full todo snapshots
- **THEN** replay restores the last valid legacy state without requiring migration of the session file

#### Scenario: Invalid persistence record is encountered

- **WHEN** replay encounters a malformed or unsupported todo record
- **THEN** it ignores that record and retains the most recent valid reconstructed state

### Requirement: Retain nested-call durability without duplicate snapshots

The extension SHALL retain a compact custom persistence path for todo calls made through nested tool execution and SHALL avoid treating the direct tool result and its matching custom record as two separate state mutations.

#### Scenario: Nested mutation survives lifecycle replay

- **WHEN** a task mutation is invoked through another tool and no standalone todo tool result is placed on the branch
- **THEN** replay restores the mutation from the compact custom record

#### Scenario: Direct mutation is not applied twice

- **WHEN** a direct todo mutation produces both a custom persistence record and a tool result
- **THEN** replay reconstructs the mutation exactly once
