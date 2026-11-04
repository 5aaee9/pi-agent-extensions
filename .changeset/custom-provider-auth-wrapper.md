---
"@indexyz/pi-custom-provider": patch
---

A `!command` key with `authHeader: "authorization"` now goes through Pi's own authorization handling, so the command no longer runs a second time for each request.
