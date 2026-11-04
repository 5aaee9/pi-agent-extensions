---
"@indexyz/pi-provider-sub2api": patch
---

`/reload` no longer keeps a previous registration: after an API switch only the current token is sent through the right handler, and a relay removed from `sub2api.json` is unlisted and receives nothing. `/sub2api-refresh` also drops the Codex handler when a relay's last Codex model disappears.
