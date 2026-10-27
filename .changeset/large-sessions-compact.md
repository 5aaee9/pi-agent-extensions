---
"@indexyz/pi-provider-sub2api": patch
---

Raise the native Codex compaction timeout from three to five minutes. Sessions holding more than roughly 200k tokens regularly need longer than the old limit for a remote compaction round trip, and the abort threw away the native checkpoint and forced the textual fallback.
