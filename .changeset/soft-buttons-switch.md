---
"@indexyz/pi-autocompact": minor
---

Add provider and global compaction caps (`providerLimits`, `globalLimit`, `/autocompact <value> --save-provider` / `--save-global`) and context-window percentages such as `80%` at every level. The effective threshold is the lowest of the model threshold, the caps, and the context window; `off` now also ignores the caps for the session.
