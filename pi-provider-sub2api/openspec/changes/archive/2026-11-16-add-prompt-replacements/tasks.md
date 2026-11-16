# Tasks

## 1. Configuration and replacement

- [x] 1.1 Parse optional `promptReplacements` on a provider entry, reject an invalid list, rule, pattern, `from`, or `to` without echoing the token, and verify with package tests for omission, an empty list, unknown rule fields, and those rejections.
- [x] 1.2 Replace literal `instructions` text for the current provider and model in declaration order, including wildcards, a missing phrase, a non-string `instructions`, and unchanged sibling fields, and verify with package tests for each of those cases.
- [x] 1.3 Register the handler on the existing `before_provider_request` chain after the other payload edits, ship the module in `files`, and verify a Codex request through the Pi scenario: a matching model changes only the configured sentence, a non-matching model and another provider keep it, and the rest of the prompt remains.

## 2. Docs and release

- [x] 2.1 Document `promptReplacements` in the package README, including pattern rules, order, the `instructions` field, and that native compaction is separate, and verify the documented example loads.
- [x] 2.2 Record a `minor` intent for `@indexyz/pi-provider-sub2api` and verify `npm run release:gate -- --base origin/main --head HEAD` accepts the branch after the change is committed.

## Workflow follow-up

- Archive the change after verification, syncing the prompt-replacements spec into `openspec/specs/`.
