---
"@indexyz/dsh-custom-provider-reasoning-efforts": none
---

Verification only: the test plane now declares the host packages it boots (`dsh-app-boot`, `dsh-home-paths`, `dsh-config-editor`) and mounts the real file-backed credentials store (`dsh-credentials`, `dsh-credentials-local`) as exact development dependencies, so discovery's store-before-environment credential order is checked through the real store. Only test files and development dependencies changed; published runtime code is unchanged.
