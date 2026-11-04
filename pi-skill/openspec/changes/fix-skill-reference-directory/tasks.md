# Tasks

## 1. Fix

- [x] 1.1 Add scenario "$known and /skill:known give the model the same block, ahead of the prompt" to `scripts/e2e/pi/pi-skill.e2e.ts` and observe it fail before the fix.
- [x] 1.2 Use `dirname(filePath)` for the skill's base directory; verify the scenario passes and that restoring `sourceInfo.baseDir` fails it.
- [x] 1.3 Replace the test `expands a leading $skill token`, which pinned the wrong directory, and remove the unread `text` field from `expandSkillTokens`; verify the package check passes.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-skill`; verify `npm run change:status` lists it.

## 2. README

- [x] 2.1 Add scenario "$$known reaches the model as written, with no skill block" and read what the model receives; verify that removing the lookbehind from the token pattern fails it.
- [x] 2.2 Correct the README's `$$name` sentence to the observed behaviour. It ships under the `patch` intent of task 1.4; no second intent.
