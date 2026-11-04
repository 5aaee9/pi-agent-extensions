# Tasks

## 1. Fix

- [x] 1.1 Strengthen the steer and follow-up scenarios in `scripts/e2e/pi/pi-skill.e2e.ts` to require block and text together with no extra request, and observe them fail before the fix.
- [x] 1.2 Return `action: "transform"` with the block ahead of the text while streaming; verify both scenarios pass, and the terminal scenario still renders `[skill] known` with no raw block.
- [x] 1.3 Correct the README; record a `patch` intent for `@indexyz/pi-skill`.
