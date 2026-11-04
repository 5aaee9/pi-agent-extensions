# Proposal

## Why

A `$skill` queued while the model is answering takes a model turn of its own: the model answers the skill block alone, and the user's words arrive in a later turn. The README says the block precedes the prompt. The block and the text are two items in Pi's queue, delivered one at a time.

A probe of the alternatives: `deliverAs: "nextTurn"` makes two requests but silently loses the block, which waits for a later user prompt. Pi's `all` queue mode delivers both together but is a user setting.

## What Changes

- While the model is answering, `$skill` embeds its block in the queued text, the shape Pi itself uses for `/skill:`, so both reach the model together. An idle prompt is unchanged: the block travels as its own message and the prompt stays as written.

## Capabilities

### New Capabilities

- `skill-delivery`: when and how a `$skill` block reaches the model.

### Modified Capabilities

None.

## Impact

`pi-skill/index.ts` and `README.md`. With several skills queued in one message, Pi's terminal collapses only the first block and shows the rest as text. `@indexyz/pi-skill` gets a `patch` release intent. Scenarios land in `scripts/e2e/pi/pi-skill.e2e.ts`.
