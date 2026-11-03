---
"@indexyz/pi-idle-compression": minor
---

First release: compact a session's context automatically after it has been idle (no new input) for a configurable time, 50 minutes by default, set globally, per provider, or per model in `settings.json` under `piIdleCompression`. `/idle-compression` shows the effective idle time and the time left.
