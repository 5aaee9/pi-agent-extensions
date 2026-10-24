---
"@indexyz/dsh-autocompact": patch
---

Fix activation on dsh 0.2.1, where the preset registry no longer exports serviceForAgent. Preset compaction backends are resolved with agentPresets.serviceFor, which 0.2.0-rc.2 and 0.2.1-rc.2 both provide.
