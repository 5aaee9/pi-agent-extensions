---
"@indexyz/pi-provider-sub2api": minor
---

Breaking: require Pi 1.6.0 or newer. Prompt replacements no longer apply on older hosts. Prompt replacements now edit the leading Codex system prompt. Native compaction sends the prompt once and keeps it out of new checkpoints, so later turns keep their current prompt and replay history after prompt changes. As in Codex, native compaction ignores /compact <text> guidance with a notice. A checkpoint written by 0.6.0 on Pi 1.6.0 may retain a stale prompt until the retention budget evicts it or a new session starts.
