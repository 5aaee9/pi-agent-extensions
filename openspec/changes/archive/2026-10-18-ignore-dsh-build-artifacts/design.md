# Design

## Context

All three dsh packages already run typecheck, build, and tests from `prepack`. Their `files` lists include `lib` and, for the two browser plugins, `client.js`. The release gate currently follows `files`, missing unpublished root TypeScript inputs. The existing dsh support and autocompact proposals are still in flight and describe the old tracked-output policy; this change supersedes that policy without claiming their unrelated live verification tasks are complete.

## Goals / Non-Goals

**Goals:** Reproducible source-only Git checkouts, working npm artifacts, explicit local build instructions, and release decisions covering generated runtime content.

**Non-Goals:** Runtime changes, version bumps, publication, altering live profiles, automatic build hooks on consumer installation, or changes to Pi release classification.

## Decisions

- Install exact OpenSpec `1.14.3` as a root dev dependency. A global install would not be reproduced by `npm ci`; documentation uses `npx openspec` in the selected root.
- Add anchored ignore patterns and use `git rm --cached` on verified artifact paths. Keep local files available to linked profiles. Preserve the existing formatter/linter exclusions and npm allowlists.
- Extend the gate input with the already-parsed manifest's dsh flag. For dsh packages, count root `.ts`/`.tsx` runtime modules (excluding root test/spec files and `vitest.config.ts`), all `src/` paths, root `tsconfig*.json`, and `tsdown.config.ts`. This convention-based rule covers the current layouts without adding a manifest field or trying to execute/parse build configurations. Preserve the published allowlist check as the first classification rule.
- Add pure decision and CLI fixture regression tests, including preparation-plus-source changes, non-dsh behavior, and development-only files.
- Resolve autocompact's generated client test import through a runtime URL. Its literal import previously made `tsc --noEmit` require `client.js` before `check` reached the build step. Keep tests exercising the emitted bundle and retain the existing typecheck/build/test order without weakening compiler rules.
- Use an isolated temporary copy of the current worktree excluding generated output and dependencies, attach installed dependencies, and run real `npm pack` with lifecycle scripts for each dsh package. Inspect and install each tarball in isolation and run its declared smoke script. This proves clean-source packaging without removing files used by a running profile.
- Write one `none` intent per dsh package: runtime sources and npm runtime output remain unchanged; README/build-tracking policy changes alone do not warrant a runtime release.

## Risks / Trade-offs

- Local clones need a build before linking → document the exact workspace build command in every affected README and repository workflow.
- Future packages introduce build inputs outside these conventions → update the documented classifier and its regression cases alongside that layout change.
- Historical proposals retain the old policy → add explicit supersession notices to the active affected planning documents; current policy and main specs are authoritative.
- `npm pack --ignore-scripts` bypasses rebuilding → verify ordinary packing, matching the release engine's existing invocation.

## Migration Plan

Update policy, docs, and release classification; remove only artifact index entries; run checks and isolated packaging; sync and archive this change. No live profile migration is necessary because local output remains on disk. Reverting this change can restore tracked artifacts without changing package APIs.
