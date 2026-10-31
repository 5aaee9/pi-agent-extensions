---
"@indexyz/dsh-autocompact": none
---

Verification only: the client half is now checked by booting the real Harness web plane in a browser — the settings section mounts through the host's own navigation and slot, and its switch toggle and threshold save go through the host's real settings service with cross-page readback — and the installed-package check loads the packed tarball into that same plane instead of a jsdom module loader. Only test files and development dependencies changed; published runtime code is unchanged.
