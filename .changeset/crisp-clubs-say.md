---
"@indexyz/pi-provider-sub2api": minor
---

Fast, Ultrafast, and Daybreak are now per provider and model: `requestModes` and `modelRequestModes` in `sub2api.json` set saved defaults, toggles change only the selected model in memory, and the new `/sub2api-save` (or `/sub2api-save provider`) writes the current modes to the configuration. Breaking: toggles no longer apply to every provider and model, and turning a tier off now sends `service_tier: "default"` instead of leaving the request tier untouched. Native compaction without a configured tier follows the conversation model's resolved tier.
