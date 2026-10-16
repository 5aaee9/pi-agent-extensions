---
name: pi-extension-dev
description: Build, change, or debug a Pi coding-agent extension in this npm workspace. Use when creating or editing anything under a root-level pi-*/ package directory, when registering commands, providers, events, or UI with Pi's ExtensionAPI, or when unsure how a Pi API behaves.
---

# Pi extension development

This repository's rules are in `AGENTS.md` and `docs/` at the repository root. This skill is the procedure that ties them together; it does not repeat them.

## Procedure

1. Read `docs/conventions.md` and `docs/workflow.md` if not already read in this session.
2. Make sure dependencies are installed (`npm install` at the repository root). Find the Pi version the package pins in its `package.json` `devDependencies` and the matching installed copy of `@earendil-works/pi-coding-agent` (`docs/pi-reference.md`): the package's own `<name>/node_modules/` when it pins a different version than the root, otherwise the root `node_modules/`. It contains Pi's docs, examples, and types for that version.
3. For non-trivial work, plan with OpenSpec first using the package directory as the working directory (`docs/workflow.md`, "Plan with OpenSpec"); read the package's `README.md` and `openspec/specs/` before changing behavior. A new package gets its own root via `openspec init <name> --tools none --no-animation`.
4. For every Pi API you will touch, read the relevant section of that copy's `docs/extensions.md` (or the doc named in `docs/pi-reference.md`) and open the closest example under `examples/extensions/`. Confirm signatures in the `.d.ts` files under `dist/` when the doc is not explicit. Answer Pi API questions from that installed copy, not from memory.
5. Implement with `index.ts` as thin wiring and logic in separate modules with tests under `test/`. Add every new module to the package's `files` (and to `tsconfig.json` `include` when it lists files explicitly).
6. Verify as described in `docs/workflow.md`, "Verify": `npm run check`, the RPC load smoke test (`printf '{"id":"1","type":"get_commands"}\n' | node_modules/.bin/pi -ne -e ./<name>/index.ts --mode rpc`, with the package's own `pi` binary when it pins its own Pi version), and a live check with `pi -e ./<name>/index.ts` for anything that needs a session. Restart Pi after editing; a running session keeps the old code.
7. Record the release decision for every package whose published content changed, following `docs/releases.md`: `npm run change -- --<patch|minor|major> @indexyz/<name> -m "<user-facing change>"`, or a hand-written `none` intent with the reason no release is needed. One intent file per package; use the full `@indexyz/<name>` here while the directory stays `<name>/`.
8. Update the package README and the root README table, archive the OpenSpec change, then commit with the directory name without `pi-` as scope (`fix(skill): ...`).

Do not prepare versions, push to `main`, merge a release pull request, or dispatch the publish workflow unless that is the explicit request; `docs/releases.md` is the procedure when it is.

## When something does not typecheck

The strict settings are intentional. Do not cast around a type error or suppress it. Find the type in the installed Pi declarations, find an example that uses the same API, and match its shape. If Pi's types genuinely prevent the design, change the design and say so in the final report.

## Report

End with: what changed, what was verified and how (commands and the observed result), the release decision recorded, and anything not verified.
