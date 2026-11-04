# Design

## Context

See proposal.md for the reproduced loss of preceding boundary entries. Pi treats a returned boundary `entries` list as a replacement, and projects earlier proposals into the context supplied to subsequent handlers.

## Goals / Non-Goals

**Goals:** Keep the committed entries consistent with the projected context used to generate the summary.

**Non-Goals:** Change compaction thresholds, summary generation, or Pi's boundary validation.

## Decisions

Return a new list containing `event.entries` followed by the new compaction entry. This preserves order without mutating the incoming proposal list. Returning only the summary loses preceding entries; independently persisting earlier entries would bypass Pi's boundary validation.

## Risks / Trade-offs

Earlier extensions may propose context edits as well as metadata. Verify both through the real loader and model transport, checking persisted order and the resulting projected context.
