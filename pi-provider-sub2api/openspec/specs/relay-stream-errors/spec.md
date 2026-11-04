# relay-stream-errors Specification

## Purpose

Define how a relayed Codex stream failure reaches Pi, so Pi's retry and overflow handling can act on it.

## Requirements

### Requirement: Relayed stream read errors are retried

The Codex stream handler SHALL report a relayed `stream_read_error` to Pi in the form Pi's retry handling recognizes, so the turn is retried without any retry loop in the extension.

#### Scenario: SSE error event carrying the code

- **WHEN** a relay stream sends an `error` event whose `code` is `stream_read_error` and whose message is empty
- **THEN** Pi retries the turn and the second attempt's answer completes it

#### Scenario: SSE error event carrying the message

- **WHEN** a relay stream sends an `error` event whose `message` is `stream_read_error`
- **THEN** Pi retries the turn and the second attempt's answer completes it

#### Scenario: Failed response

- **WHEN** a relay stream sends `response.failed` with the error `stream_read_error`
- **THEN** Pi retries the turn and the second attempt's answer completes it

### Requirement: Other failures reach Pi unchanged

The handler SHALL leave every other error message unchanged, so a permanent failure is not retried and a context overflow still runs Pi's compaction recovery.

#### Scenario: Permanent failure

- **WHEN** a relay stream sends `response.failed` with an error Pi does not classify as transient
- **THEN** the turn ends after one attempt

#### Scenario: Context overflow

- **WHEN** a relay stream reports that the input exceeds the context window
- **THEN** Pi compacts through native compaction and retries the turn with the checkpoint replayed
