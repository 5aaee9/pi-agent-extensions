---
"@indexyz/pi-custom-provider": patch
---

`--offline` and `PI_OFFLINE=1` now stop the extension's automatic model discovery, models.dev fetches, and background refreshes: it registers cached models or `fallbackModels` instead. `/refresh-custom-provider-models` still works.
