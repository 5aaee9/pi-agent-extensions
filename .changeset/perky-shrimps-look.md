---
"@indexyz/dsh-autocompact": minor
---

Add a deployment-wide default threshold: set it in Settings → Autocompact and every model without its own threshold compacts early at that count, while per-model entries and /autocompact still take precedence. Leaving it empty keeps those models on the backend's own compaction.
