# Design

## Context

Pi 0.84.0 emits `agent_settled` when it will not continue on its own, `agent_start` when a run begins, and `input` for every user prompt. `ctx.compact()` runs native manual compaction (including `session_before_compact` hooks) and aborts any running agent first. The extension context's members are lazy getters that throw once the runtime is replaced, so a context captured in a handler stays usable until `session_shutdown`.

## Goals / Non-Goals

**Goals:**

- Compact exactly once per idle period, only while Pi is idle and nothing is queued.
- Layered settings: model over provider over top level over built-in defaults.

**Non-Goals:**

- Writing settings from a command, project-level settings, or a custom summarizer.
- Compacting on a token threshold (that is `pi-autocompact`).

## Decisions

### 1. The idle period starts at `agent_settled` and at `session_start`

**Choice:** Arm a timer on `agent_settled`, and on `session_start` when the branch already contains an assistant reply (a resumed or reloaded session). Cancel it on `input`, `agent_start`, `session_compact`, and `session_shutdown`. `model_select` re-arms the timer for the new model, keeping the original idle start.

**Why:** `agent_end` may still be followed by retries or follow-ups; `agent_settled` is the documented "Pi is done" signal. A session opened from disk is idle too, but its idle time starts when it is opened, so resuming an old session does not compact before the user can type.

### 2. Re-check before compacting

**Choice:** When the timer fires, skip if the session is not idle, has pending messages, the last branch entry is already a compaction, or Pi reports the context as unmeasured (`tokens === null`, i.e. compacted and not re-measured). Otherwise call `ctx.compact()` and report start, completion, and failure through `ctx.ui.notify`.

**Why:** `ctx.compact()` aborts a running agent; idle compaction must never interrupt work. The other checks avoid the "Already compacted" error and pointless model calls.

### 3. Read settings when arming

**Choice:** Read user `settings.json` each time the timer is armed. A malformed value reports an error and leaves the timer unarmed.

**Why:** Edits apply at the next idle period without `/reload`, and the read is a small local file.

### 4. Timer hygiene

**Choice:** The timer is `unref()`ed so it never keeps print or RPC mode alive, and `idleMinutes` must be a positive number no larger than the largest `setTimeout` delay (35791 minutes). Fractional minutes are allowed.

## Risks / Trade-offs

- Compaction costs a model call even if the user never returns. → It can be disabled globally or per provider/model.
- A prompt typed while idle compaction runs waits for it, like after `/compact`.
