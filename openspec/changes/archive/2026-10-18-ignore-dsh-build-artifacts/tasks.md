# Tasks

## 1. Build policy and tooling

- [x] 1.1 Pin OpenSpec as root tooling, document `npx openspec`, and verify its version and repository context.
- [x] 1.2 Ignore and untrack dsh generated output while preserving disk files; verify `git ls-files` returns no artifacts and `git check-ignore` matches them.
- [x] 1.3 Update repository rules, architecture/workflow docs, package checkout instructions, and planning supersession notices; add a reasoned `none` intent for each dsh package and verify there are no current-policy claims requiring tracked output.

## 2. Release impact

- [x] 2.1 Extend dsh release classification to build inputs and document the rule; add unit and CLI regression tests covering runtime sources, configs, development-only changes, Pi classification, and mixed release preparations; verify the gate tests pass.

## 3. Integration verification

- [x] 3.0 Resolve the generated autocompact client test import at runtime; verify typecheck and packing succeed without an existing client bundle while its client tests still exercise the built output.

- [x] 3.1 Run `npm run check`; pack all three dsh packages from a source-only temporary checkout, inspect and install the tarballs, and run each declared load smoke script from `docs/workflow.md`. Verify the build leaves generated output ignored and review the final diff.

Verification: `npm run check` passed (540 package tests and 85 release-tool tests). All three source-only `npm pack` runs, tarball inspections, isolated installs, and declared smoke checks passed. All 50 previously tracked generated files remain on disk and match their HEAD bytes exactly. No live profile was changed or restarted; this change does not alter runtime output.

## Workflow follow-up

- Validate, sync, and archive this change after verification; leave unrelated in-flight tasks untouched.
