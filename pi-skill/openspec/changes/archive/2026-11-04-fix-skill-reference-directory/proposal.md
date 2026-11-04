# Proposal

## Why

`$known` tells the model that the skill's references are relative to the agent directory, while Pi's own `/skill:known` says the skill's directory. `skillsFromCommands` read `sourceInfo.baseDir`, which is the discovery root rather than the skill's location. A skill that references `./helper.md` therefore points the model at the wrong file when invoked as `$known`, contrary to the README's promise that relative references keep working.

The README also says `$$name` gives a literal `$name`. The prompt is never rewritten: the model receives `$$name`, both dollar signs included.

## What Changes

- The `References are relative to` line uses `dirname(filePath)`, the definition Pi uses for `skill.baseDir`, so a token and the command send identical blocks.
- `expandSkillTokens` stops building a rewritten prompt `text` that nothing reads, which removes the assertions that pinned the wrong directory.
- The README states what `$$name` does.

## Capabilities

### New Capabilities

- `skill-invocation`: what the model receives for a `$skill` token.

### Modified Capabilities

None.

## Impact

`pi-skill/index.ts` and `pi-skill/README.md`. `@indexyz/pi-skill` gets a `patch` release intent. The regression scenario lands in `scripts/e2e/pi/pi-skill.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
