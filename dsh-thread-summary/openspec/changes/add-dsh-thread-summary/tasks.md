# Tasks

## 1. Package skeleton and manifest

- [x] 1.1 Create the package skeleton, bundle patch, workspace entry and initial OpenSpec artifacts.
- [x] 1.2 Declare the actual title/timeout host dependencies with exact pins and peers, plus local renderer test dependencies; record the release decision without changing versions.

## 2. Host summary provider

- [x] 2.1 Use the actual SessionTitleProvider contract and live volatile config; explicitly select and attribute only the first message, including refresh.
- [x] 2.2 Bound the actual system plus JSON-framed input to 4,096 UTF-8 bytes and add concise language-aware title instructions.
- [x] 2.3 Add a disposable 60-second deadline, cancellation checks, stream validation and Unicode-safe 36-code-point/80-byte normalization; remove unused helpers and temporary diagnostic logging.

## 3. Settings UI

- [x] 3.1 Retain the General row and locale dictionaries, add a crash boundary and contain remote failures.
- [x] 3.2 Verify provider/model selection, revision conflicts, read-only state, saving state and disabling without a model; avoid redundant catalog fetches.

## 4. Tests and docs

- [x] 4.1 Test captured production requests, stream outcomes, deadlines, cancellation, normalization, live config and first-message attribution.
- [x] 4.2 Test title persistence, fallback and manual rename races with real Harness services and a mock LLM.
- [x] 4.3 Test client settings rendering and persistence/error states.
- [x] 4.4 Evaluate the packaged client through the module loader in release smoke; document installation, limits, fallback and reload behavior.

## 5. Verification

- [x] 5.1 Run package typecheck/build/tests and smoke against a packed and installed tarball.
- [x] 5.2 Run repository `npm run check` and validate the OpenSpec change.
- [ ] 5.3 Install into the web profile and verify Settings → General, first-input title generation, fallback, manual rename preservation, and live config updates with a real model.
- [x] 5.4 Run the release-impact gate after the change is committed on a branch.

## 6. Native WebUI alignment

- [x] 6.1 Reuse host Button/Switch/Menu controls, replace the nested card with the General row layout, and support narrow layouts and localized status text.
- [x] 6.2 Update control interaction tests and packed-module smoke for the external primitive module; rebuild and run repository checks.
- [x] 6.3 Verify light/dark/narrow layouts and keyboard interactions with actual DSH primitives in an isolated browser fixture, documenting the distinction from the authenticated running GUI.

## Verification record

- Repository `npm run check` passed: formatting, lint, all workspace typechecks/builds/tests and 80 release-tooling tests. This plugin has 46 passing tests, including four real Cordis/session/title/projection integration tests with a mocked LLM.
- Packed the newly built artifacts with `npm pack --ignore-scripts`, installed the tarball into an isolated temporary directory using `--omit=peer --legacy-peer-deps`, and ran the declared smoke script successfully. The ignored lifecycle is already covered by the full check above.
- `openspec validate add-dsh-thread-summary --strict` passed.
- Web-profile verification was not performed: the DSH plugin CLI attempted to create `/home/coder/.dsh/profiles/web/package.json.lock`, which the workspace-write sandbox denied. Mock integration tests do not complete this real-model web check.
- Native UI follow-up: repository checks and the newly packed/installed tarball smoke passed again. An isolated Chromium fixture loaded the built bundle against the installed rc.2 shell's actual React, Button/Switch/Menu and theme CSS. Assertions passed for light/dark tokens, 36px control height and 12px corners, desktop two-column and 375px stacked layouts, no horizontal overflow (including an open menu), keyboard menu selection/Escape focus return, Space toggle and Enter save with the expected revision/payload. English and Chinese screenshots were generated; image inspection was unavailable in this model, so layout verification uses browser-computed metrics and interaction assertions. This does not certify the authenticated GUI or a real-model request. The web profile resolves this plugin to the workspace directory; refresh the browser to load its rebuilt client bundle.
- Source changes were committed and synchronized with origin/main; the branch-based release-impact gate passed. The user subsequently selected the initial `0.1.0` version instead of the unpushed `0.1.1` preparation. The initial version commit includes the full release notes and a reasoned `none` intent because no additional bump is needed. A separate empty `0.0.0` workspace is prepared for the owner to publish and configure npm Trusted Publisher before the formal `0.1.0` commit is pushed.

The change remains active until the outstanding real-model deployment verification is complete.
