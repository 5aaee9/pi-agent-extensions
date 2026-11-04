---
"@indexyz/pi-skill": patch
---

`$skill` now tells the model that a skill's references are relative to the skill's own directory, matching `/skill:name`. It previously named the agent directory, which pointed relative references at the wrong files.
