---
"@indexyz/pi-ask": patch
---

`/answer` now falls back to the chat model when the configured extraction models have no credentials, where it previously failed with `Provider is not configured`. The settings overlay and configuration docs name `@indexyz/pi-ask`.
