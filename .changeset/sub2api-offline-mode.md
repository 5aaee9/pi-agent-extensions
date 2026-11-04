---
"@indexyz/pi-provider-sub2api": patch
---

Under `--offline` or `PI_OFFLINE=1` the extension no longer sends discovery, billing, or usage requests by itself. Cached models stay available, and model requests and `/sub2api-refresh` still reach the relay.
