# Spec Delta

## Purpose

Generate one ephemeral next-message suggestion after an eligible successful reply without changing the main conversation.

## ADDED Requirements

### Requirement: Eligible live turns only

The Host SHALL generate a suggestion only after a live `turn/end` whose reason is `completed`, whose turn contains direct human user text and visible assistant text, and whose session has an open composer that has asked for suggestions. Failed, aborted, interrupted, text-free, restored, replayed, and forked turns MUST NOT trigger generation.

#### Scenario: Successful completed turn

- **WHEN** a watched session completes a turn with a direct human prompt and an assistant text reply
- **THEN** the Host starts one suggestion generation for that turn

#### Scenario: Ineligible turn reasons

- **WHEN** a turn ends as aborted, error, blocked, max-tokens, interrupted, or forked
- **THEN** the Host starts no generation and clears any pending suggestion for that session

#### Scenario: Replayed history

- **WHEN** a session is restored, resumed, forked, or replayed from stored events without a live completion
- **THEN** no suggestion generation starts for the replayed turn

#### Scenario: No watched composer

- **WHEN** a completed turn belongs to a session whose composer has never queried suggestions
- **THEN** the Host makes no auxiliary model request for that turn

### Requirement: Current route with low reasoning

The Host SHALL reuse the provider and model from the session's latest request header and SHALL request the lowest reasoning effort that route advertises. The auxiliary request MUST be independent of the main agent loop and MUST NOT inherit its goal.

#### Scenario: Route reuse

- **WHEN** the latest request header names a provider and model
- **THEN** the suggestion call uses that exact provider and model

#### Scenario: Low effort selection

- **WHEN** the route advertises low, off, minimal, none, or only higher efforts
- **THEN** the Host chooses low when present, otherwise off, minimal, or none, otherwise the lowest advertised effort, and omits the field when no effort is advertised

#### Scenario: Missing route

- **WHEN** the session has no request header or the header has no provider/model
- **THEN** no model call is made and the result is "no suggestion"

### Requirement: Bounded visible history

The Host SHALL frame at most the eight most recent completed user/assistant exchanges and SHALL keep the instructions plus framed input within 4,096 UTF-8 bytes without splitting a Unicode code point. Only direct human user text and visible assistant text may be included; reasoning, tool results, tool arguments, system prompts, developer context, synthetic user context, and attachments MUST be excluded.

#### Scenario: Long conversation

- **WHEN** more than eight completed exchanges exist
- **THEN** only the newest eight are sent and the oldest are omitted

#### Scenario: Oversized exchange

- **WHEN** the framed input exceeds the byte budget
- **THEN** the prompt is clipped at code-point boundaries into valid JSON within the budget, or generation is skipped when no usable payload fits

#### Scenario: Non-visible context

- **WHEN** the conversation contains tool results, reasoning, system prompts, synthetic user context, or attachments
- **THEN** none of that content appears in the auxiliary request

### Requirement: Ephemeral isolated request

The suggestion request SHALL be tool-free and MUST NOT append session events, write storage, use hooks, connectors, environment access, or invoke any suggested task. The result MUST live only in Host memory until the browser reads it or the turn is invalidated.

#### Scenario: No session writes

- **WHEN** a suggestion is generated and read
- **THEN** the session event log is unchanged and no conversation entry appears

#### Scenario: No tool execution

- **WHEN** the auxiliary model returns a tool call or text that describes a task
- **THEN** the Host performs no tool call and does not execute the task

### Requirement: Deadline, cancellation, and stale results

Each auxiliary request SHALL be bounded by a 30-second deadline. A new turn, session disposal, plugin disposal, disabling generation, or the browser aborting its query SHALL abort in-flight work and discard its late result.

#### Scenario: Timeout

- **WHEN** the auxiliary request produces no completion within 30 seconds
- **THEN** it is aborted, its timer is released, and the result is "no suggestion"

#### Scenario: New turn

- **WHEN** a new turn starts while a suggestion is pending
- **THEN** the pending request is aborted and its late output is not shown

#### Scenario: Session disposal

- **WHEN** the session leaves the live store
- **THEN** its pending request is aborted and all waiting queries settle

#### Scenario: Query aborted

- **WHEN** the browser aborts its suggestion query because the composer closed, the session switched, or the switch turned off
- **THEN** the Host aborts the in-flight auxiliary call instead of spending its remaining deadline

### Requirement: Output validation and cost

The Host SHALL accept only a single-line plain-text prediction, strip fences, labels, control characters, and enclosing quotes, and cap the display at 200 Unicode code points. It MUST reject empty output, tool calls, non-stop finishes, and invalid or overlong results as "no suggestion". Each eligible live reply SHALL add exactly one auxiliary model request, and disabled settings SHALL add none.

#### Scenario: Invalid output

- **WHEN** the model returns empty text, only reasoning, a tool call, a non-stop finish, or no completion
- **THEN** no suggestion is produced

#### Scenario: Normalized output

- **WHEN** the model returns quotes, a Markdown fence, a suggestion label, multiple lines, or control characters
- **THEN** the Host returns one normalized plain-text line or no suggestion

#### Scenario: Request count

- **WHEN** one eligible reply completes and settings are enabled
- **THEN** exactly one auxiliary model request is made for that turn

#### Scenario: Disabled generation

- **WHEN** the enabled switch is off
- **THEN** no auxiliary model request is made and queries answer "disabled"
