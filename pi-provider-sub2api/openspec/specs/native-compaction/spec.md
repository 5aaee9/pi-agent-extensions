# native-compaction Specification

## Purpose

Defines how the relay's native Codex compaction carries the conversation's system prompt in the compaction request, keeps it out of the stored checkpoint, and keeps it intact on turns that replay a checkpoint.

## Requirements

### Requirement: The compaction request carries the system prompt once

A native compaction request MUST carry the system prompt exactly once, as its first `input` item, followed by the conversation and then `compaction_trigger`, as Codex's remote compaction request is built. The request MUST NOT have a top-level `instructions` field, and no other item the extension adds MUST repeat the system prompt. A system prompt item carried in a window an earlier version wrote is sent as stored.

#### Scenario: A first compaction

- **WHEN** `/openai-compress` runs on a session with no checkpoint
- **THEN** the compaction request's first `input` item is the current system prompt and the request has no `instructions` field
- **AND** no other `input` item is a `developer` or `system` message carrying the system prompt

#### Scenario: A compaction from a checkpoint

- **WHEN** a session already has a native checkpoint whose window holds no system prompt item and compacts again
- **THEN** the request's first `input` item is the current system prompt, followed by the replayed checkpoint window and the conversation after it, with no `instructions` field and no second system prompt item

#### Scenario: The prompt changed after the last checkpoint

- **WHEN** a session compacts natively, one turn runs, the active tool set then changes, another turn runs, and the session compacts again
- **THEN** the second compaction request's first `input` item reflects the changed tool set, and no other item carries the system prompt or the change

### Requirement: The compaction request uses Pi's current system prompt

The compaction request's system prompt item MUST hold Pi's current system prompt: the running turn's prompt, including one an extension forces, or the base prompt with the current tools when no turn is running. Its role MUST be the one Pi gives the conversation model: `developer` for a reasoning model without `supportsDeveloperRole: false`, `system` otherwise. The item MUST be omitted when the prompt is empty.

#### Scenario: An extension forces the system prompt

- **WHEN** a `before_agent_start` handler returns a `systemPrompt` and a compaction runs inside that turn's run, such as context-overflow recovery
- **THEN** the compaction request's first `input` item carries the forced prompt, as the turn's own first item does

#### Scenario: An idle compaction with a forcing extension

- **WHEN** such a handler is installed and `/openai-compress` runs while no turn is running
- **THEN** the compaction request's first `input` item carries the base prompt, because a forced prompt exists only during a run

### Requirement: Native compaction sends no custom guidance

A native compaction request MUST NOT carry custom compaction instructions in any field or `input` item, matching Codex's remote compaction. When Pi requests compaction with non-blank custom instructions from the user or another extension, the extension MUST still compact natively without them, and MUST notify the user that native compaction ignores custom instructions. Blank custom instructions and `/openai-compress` MUST NOT produce that notice.

#### Scenario: Compaction with custom instructions

- **WHEN** Pi compacts with custom instructions `FOCUS-GUIDANCE` on a relay Codex model
- **THEN** native compaction runs, the compaction request ends with the conversation followed by `compaction_trigger`, and no part of it contains `FOCUS-GUIDANCE`
- **AND** the user sees a notice that native compaction ignores custom instructions

#### Scenario: Blank custom instructions

- **WHEN** Pi compacts with custom instructions that are only whitespace
- **THEN** native compaction runs and no notice is shown

#### Scenario: The one-off command

- **WHEN** `/openai-compress` runs
- **THEN** no notice about custom instructions is shown

### Requirement: The checkpoint does not store the system prompt

The replay window this version stores in a native checkpoint MUST NOT add the system prompt, including system prompt updates made since an earlier checkpoint. A system prompt item already present in a window an earlier version wrote is carried as a retained message, as stored, until the retention budget drops it.

#### Scenario: A short conversation

- **WHEN** a short conversation is compacted natively
- **THEN** the stored window holds the retained user messages and the compaction item, and no item carrying the system prompt

#### Scenario: A prompt update after an earlier checkpoint

- **WHEN** a turn runs after a checkpoint, the active tool set then changes, another turn runs, and the session compacts again
- **THEN** the new stored window holds no `developer` or `system` item carrying the system prompt or the update

### Requirement: A replayed turn keeps the current system prompt

A turn that replays a native checkpoint MUST keep the system prompt item Pi built for that turn as its first `input` item, followed by the checkpoint window. This MUST hold whichever messages the retention budget kept.

#### Scenario: The retention budget keeps no message

- **WHEN** the newest user message before compaction exceeds the retention budget, so the window holds only the compaction item
- **THEN** the next turn's first `input` item is the current system prompt, followed by the compaction item

### Requirement: Effective Pi model overrides preserve native compaction

Native compaction MUST exclude newly serialized transcript prompt updates even when the effective conversation model supports mid-conversation system messages. Replay MUST match historical reasoning-effort updates when enabled and preserve the live turn's current effort.

#### Scenario: Mid-conversation system messages

- **WHEN** a Pi model override enables `supportsMidConvoSystemMessages`, a tool is removed after a checkpoint, and another turn is compacted
- **THEN** the request starts with the current system prompt and neither the newly serialized body nor the new window adds an old prompt update
- **AND** the intervening turn replays the opaque checkpoint

#### Scenario: Mid-conversation effort

- **WHEN** a Pi model override enables `supportsMidConvoEffort` and the reasoning effort changes after a checkpoint retaining an assistant message
- **THEN** the turn replays the opaque checkpoint instead of a textual marker and keeps its current effort update

### Requirement: Replay survives a system prompt change

A change to the system prompt after a checkpoint MUST NOT stop the checkpoint from replaying. Such changes include a different active tool set and a prompt forced by an extension. The replayed turn MUST carry the system prompt Pi built for it.

#### Scenario: The active tool set changes after compaction

- **WHEN** a session compacts natively, an extension then removes a tool from the active set, and the user sends a prompt
- **THEN** the turn replays the compaction item instead of the textual checkpoint marker, and its first `input` item reflects the new tool set

#### Scenario: An extension forces the system prompt

- **WHEN** a `before_agent_start` handler returns a `systemPrompt` on every turn and the session has a native checkpoint
- **THEN** each turn replays the compaction item, and its first `input` item carries the forced prompt
