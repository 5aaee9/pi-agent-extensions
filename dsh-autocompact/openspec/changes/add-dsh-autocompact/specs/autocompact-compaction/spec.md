# Spec Delta

## Purpose

Define the automatic pressure check of `@indexyz/dsh-autocompact`: when it measures a session, what it measures, which range it compacts through the mounted backend, how that backend is found for the exact agent, and how every failure is contained so a turn is never aborted.

## ADDED Requirements

### Requirement: Pressure is measured at the agent/pre-step boundary

The plugin SHALL handle the `agent/pre-step` boundary for every agent. At that boundary it SHALL, in order: respect the master switch and an already-aborted signal; resolve the exact routed `provider/model`; resolve the effective threshold for that route (session override, then global default); resolve the agent's compaction backend; skip unless the backend performs automatic compaction; measure the session with `ctx.tokenMeter`; and act only when the measured total token count is strictly greater than the threshold. A measurement that reports no total SHALL NOT count as above the threshold. Because a new prompt enters through the same boundary, a large existing session SHALL be compacted before its next request by the same code path, with no separate idle-input path and no synthetic prompt injected.

#### Scenario: A crossing compacts before the next request

- **WHEN** a session on a thresholded route measures above its threshold at `agent/pre-step`
- **THEN** the plugin compacts before the request proceeds
- **AND** the run continues with its normal tool and follow-up scheduling

#### Scenario: Below the threshold nothing happens

- **WHEN** the measured pressure is at or below the effective threshold
- **THEN** the hook does nothing and calls the next handler immediately

#### Scenario: No threshold applies

- **WHEN** the route has neither a session override nor a global default, or the master switch is off
- **THEN** no measurement is acted on

### Requirement: The compaction uses an explicit balanced surface range and the backend's retained tail

Above the threshold, the plugin SHALL require that the mounted backend supports explicit region compaction (`compactRegion`) and SHALL then compact exactly one inclusive surface range: from the first non-system surface node (node 0 is never replaced when it holds a `system/message`) through the node before the priced recent tail, where the tail is the trailing nodes whose cumulative measured tokens reach the retained-tail budget for that route. The range SHALL be adjusted backwards so that it never begins between an assistant tool call and its result. The plugin SHALL leave the summarization, the `compaction/*` session records, and the backend's own automatic threshold to the backend, and SHALL pass the agent and the signal unchanged. When the surface is too small, or one indivisible oversized message cannot be compacted and still shrink, the plugin SHALL select no range and leave the decision to the backend's overflow or manual compaction. A mismatch between the token meter's reported surface and the session's current surface SHALL be reported as an error rather than compacted blindly.

#### Scenario: A balanced range is compacted

- **WHEN** the pressure is above the threshold and the session surface has room to shrink while retaining its recent tail
- **THEN** the plugin calls `compactRegion(start, end, agent, signal)` with an inclusive range that stops before the retained tail and does not split a tool call from its result

#### Scenario: The system head is preserved

- **WHEN** surface node 0 is the session's `system/message`
- **THEN** the range starts after it, and without such a head the range may start at node 0

#### Scenario: Nothing can shrink

- **WHEN** the surface is too small, or one indivisible message is too large to compact and still shrink
- **THEN** the plugin selects no range and the backend's own overflow or manual compaction decides

### Requirement: The backend is resolved for the exact agent

The plugin SHALL mount on the Host plane with `commands`, `tokenMeter`, and `llm` injected, and SHALL NOT inject `compaction`. For each event it SHALL resolve the compaction backend serving that exact agent through the preset registry's per-agent lookup, and SHALL fall back to the Host-plane `compaction` service for compositions that mount it there. A torn-down preset scope, an absent registry runtime, or an absent Host-plane service SHALL be treated as "no backend for this agent", never as an error that escapes the hook.

#### Scenario: The web bundle mounts compaction per preset

- **WHEN** the shipped web bundle disables the Host-plane compaction row and each agent preset mounts its own instance in an isolated realm
- **THEN** one Host-plane row of this plugin serves every preset, addressing each agent's own backend at event time

#### Scenario: A headless or SDK composition mounts compaction on the Host plane

- **WHEN** no preset-mounted backend answers for the agent
- **THEN** the plugin uses the Host-plane `compaction` service instead

### Requirement: Failures are contained and the turn is never aborted

Every error in the pressure check — a failed summary, an unreachable model lookup, an invalid effective threshold, a backend that disappears between resolution and use — SHALL be caught inside the hook, SHALL leave the session's context intact, SHALL be logged once per session for that message, and SHALL NOT abort or fail the turn. The hook SHALL always call the next handler. A subsequent step MAY try again; the plugin SHALL NOT retry at the same boundary. A backend without region compaction and a route with no known context capacity SHALL each be reported once per session and then left inert.

#### Scenario: The summary fails

- **WHEN** `compactRegion` rejects
- **THEN** the context is left as it was, the failure is logged once for that session, the turn continues, and a later step may try again

#### Scenario: The same warning does not repeat

- **WHEN** a condition that is reported once per session occurs on several steps
- **THEN** only the first occurrence is logged

#### Scenario: The signal is already aborted

- **WHEN** the hook runs with an aborted signal
- **THEN** it does nothing, logs nothing for the abort, and calls the next handler
