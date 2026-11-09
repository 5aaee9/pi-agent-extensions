---
"@indexyz/pi-provider-sub2api": patch
---

Relay requests add `type: "string"` to tool parameters whose `enum` holds only strings and has no type, so Kimi no longer rejects the whole request over them. Other enums and other providers' requests are unchanged. Affected tool definitions change once, which can cost one prompt cache miss after upgrading.
