# Spec Delta

## Purpose

为 Pi 提供一个可恢复、可审阅且返回结构化答案的交互式问题工具，使代理在需求或偏好不明确时能够询问用户而不是猜测。

## ADDED Requirements

### Requirement: Register the structured question tool

The extension SHALL register a Pi tool named `ask_user_question` with a schema containing a title and one or more questions with stable ids, prompts, and options.

#### Scenario: Valid question payload

- **WHEN** the agent invokes `ask_user_question` with valid single, multi, or preview questions
- **THEN** the extension opens the interactive ask flow and returns normalized answers keyed by question id

#### Scenario: Invalid question payload

- **WHEN** a payload has duplicate ids, duplicate option values, blank required text, no options, or invalid preview data
- **THEN** the tool returns a structured invalid-input result without opening the UI

### Requirement: Present and complete the interactive flow

The extension SHALL provide selectable options, free-form answers, question and option notes, review, submit, elaborate, and cancel actions.

#### Scenario: User submits answers

- **WHEN** the user selects or enters answers and submits the review
- **THEN** the result includes values, labels, rendered indices, custom text, and applicable notes without blocking on unanswered questions

#### Scenario: User elaborates

- **WHEN** the user chooses Elaborate with notes or an answer requiring clarification
- **THEN** the result identifies the affected question or option and includes enough normalized context for the agent to continue

### Requirement: Handle non-interactive and interrupted sessions

The extension SHALL avoid opening custom UI outside TUI mode and SHALL support replay and recovery of the newest unresolved question flow on the active session branch.

#### Scenario: Non-TUI invocation

- **WHEN** the tool runs in print, JSON, or RPC mode
- **THEN** it returns a cancelled result explaining that interactive TUI mode is required

#### Scenario: Recover unresolved flow

- **WHEN** Pi starts, resumes, or forks a TUI session with an unresolved `ask_user_question` call
- **THEN** the extension offers that flow for continuation and persists dismissal so it does not reopen repeatedly

### Requirement: Expose replay and answer extraction commands

The extension SHALL provide `/answer`, `/answer:again`, and `/ask:replay` commands for extraction or replay of question flows on the current branch.

#### Scenario: Replay a previous flow

- **WHEN** the user invokes `/ask:replay` or `/answer:again` with an available current-branch payload
- **THEN** the extension reopens the corresponding question flow

### Requirement: Publish local remote-flow events

The extension SHALL expose package-prefixed local Pi events for flow start, completion, submit, and submit-result, and SHALL accept only explicit answer or cancel remote responses.

#### Scenario: Explicit remote answer

- **WHEN** a trusted in-process extension submits question ids and normalized option values
- **THEN** the extension validates the response and completes the matching flow without inferring approval semantics from labels
