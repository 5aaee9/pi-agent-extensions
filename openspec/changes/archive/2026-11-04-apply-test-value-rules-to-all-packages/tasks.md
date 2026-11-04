# Tasks

## 1. Apply the rule

- [x] 1.1 State the test-value and regression-guard rules for every package in `docs/conventions.md`, and keep Pi's host exception in `docs/pi/README.md`.
- [x] 1.2 Audit the four dsh packages and remove the 81 cases that fail the rule, with the imports they leave unused.
- [x] 1.3 Screen the eight Pi packages for the same rule, remove the 80 test runs that fail it, and keep the regression guards whose replacements were not observed.

## 2. Verify

- [x] 2.1 Run `npx oxfmt --check`, `npx oxlint --deny-warnings`, and `npm run check --workspace` for `dsh-prompt-suggestions`, `dsh-thread-summary`, `dsh-custom-provider-reasoning-efforts`, and each Pi package; all pass.
- [ ] 2.2 Run the same for `dsh-autocompact`. It fails four cases in the unchanged `test/client-plane.test.ts`, each timing out in `openLiveSession`. The owner ruled the investigation out of scope, so this stays open.
- [x] 2.3 Run the release-impact gate against a scratch commit of the change.
- [x] 2.4 Validate this change with `npx openspec validate apply-test-value-rules-to-all-packages`.
