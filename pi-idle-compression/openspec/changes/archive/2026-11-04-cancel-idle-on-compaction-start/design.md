# Design

## Context

See proposal.md for the reproduced repeat compaction. Pi emits `session_before_compact` before summarization, but an earlier extension can cancel that dispatch before this extension's handler runs. Preparation can also fail before the event.

## Goals / Non-Goals

**Goals:** End the existing idle period for successful, failed, and cancelled native compaction attempts.

**Non-Goals:** Change idle durations, retry policy, or Pi's cache-warming decisions.

## Decisions

Use the existing idempotent cancellation function for `session_before_compact`, `session_compact`, and `session_compact_failed`. Cancelling only on completion permits a failed attempt's old timer to fire. Handling the start alone misses preparation failures and cancellations from earlier extensions. The terminal events cover those paths without introducing another timer or state machine.

Document the existing interaction with idle cache warming; no new setting or automatic policy is needed.

## Risks / Trade-offs

An ended idle period remains unarmed until later work settles or a conversation opens. Real-host regressions verify that failure and cancellation prevent repeat summaries while a later settled run still arms normally.
