# Tasks

## 1. Package skeleton and manifest

- [x] 1.1 Create the package skeleton, bundle patch, workspace entry, root README row and initial OpenSpec artifacts.
- [x] 1.2 Declare the pinned Host/client dependencies, exact peers, build scripts, `files` allowlist and release smoke entry.
- [x] 1.3 Record the first-release intent without changing versions or changelog headings.

## 2. Host generation

- [x] 2.1 Observe only eligible live `completed` turns and watched sessions; ignore failed, interrupted, text-free, restored and replayed turns.
- [x] 2.2 Reuse the latest request route and select the lowest advertised reasoning effort.
- [x] 2.3 Frame at most eight visible user/assistant exchanges within 4,096 UTF-8 bytes with Unicode-safe clipping.
- [x] 2.4 Run one tool-free auxiliary request with a disposable 30-second deadline, no session writes and no goal/tool inheritance.
- [x] 2.5 Normalize and validate output; reject empty, tool-call, non-stop, overlong and invalid results.
- [x] 2.6 Implement per-session pending/ready state, query waiters and cancellation on new turns, session disposal and plugin teardown.
- [x] 2.7 Register the authenticated Connection Fetch route and validate its Client/Server envelope.

## 3. Browser composer

- [x] 3.1 Register the `conversation.input.overlay` entry and query the Host for the current session regardless of draft, marking it watched.
- [x] 3.2 Paint dim ghost text over the native placeholder without reflow; restore the placeholder and repaint on theme changes.
- [x] 3.3 Accept with bare Tab/Right Arrow through `InputActions`, dismiss with Escape, hide on typing/paste, and never submit.
- [x] 3.4 Defer to open popups, attachments, existing drafts, IME composition and custom bare shortcut bindings.
- [x] 3.5 Clear the suggestion on new turns, session switches and disabled settings; bound retries and abort queries on unmount.

## 4. Settings

- [x] 4.1 Register the General settings row with a localized enable switch and English/Chinese dictionaries.
- [x] 4.2 Save immediately with revision checking; handle conflicts, read-only, unavailable and failed loads without crashing the page.
- [x] 4.3 Mirror the switch into a browser-local store so the overlay hides/reveals immediately and add local error boundaries.

## 5. Tests and docs

- [x] 5.1 Unit-test history selection, prompt budgeting, output normalization, effort selection, route resolution and timeout/cancellation.
- [x] 5.2 Integration-test real Cordis sessions, watched generation, replay exclusion, non-completed turns, eight-turn history, live switch and in-flight abort.
- [x] 5.3 Test the route envelope, malformed requests and failure containment.
- [x] 5.4 Test the settings row, wire validation, shortcut/popup priority, composer DOM helpers and overlay keyboard/visibility behavior.
- [x] 5.5 Evaluate the packed client through the module-loader contract in release smoke.
- [x] 5.6 Document installation, behavior, keys, priorities, cost, privacy, limits and verification; update the root README.

## 6. Verification

- [x] 6.1 Run package format/lint/typecheck/build/tests and the release smoke against the installed/packed artifacts.
- [x] 6.2 Run repository `npm run check` and validate the OpenSpec change.
- [x] 6.3a Install into an isolated copy of the web profile from the checkout and verify the composed profile contains the `prompt-suggestions` row.
- [ ] 6.3b Exercise the General switch, ghost text, acceptance, dismissal and a real-model suggestion in a live Harness UI.
- [x] 6.4 Run the release-impact gate after the change is committed on a branch.

## Verification record

- Repository `npm run check` passed: format check, full lint, all workspace typechecks/builds/tests, and 85 release-tooling tests. This package has 75 passing tests, including real Cordis/session/LLM integration tests with mocked streams.
- Packed the built artifacts with `npm pack --ignore-scripts`, installed the tarball into an isolated temporary directory with `--omit=peer --legacy-peer-deps`, and ran the declared release smoke successfully against the installed package.
- `openspec validate add-dsh-prompt-suggestions --strict` passed.
- Installed the checkout into an isolated copy of the existing web profile with `DSH_HOME=<temp> dsh plugin --profile web add ./dsh-prompt-suggestions`; `dsh --profile web --dump-config` shows the composed `id: prompt-suggestions` row and the profile lists the package bundle. The live copy was not modified.
- Live Harness UI verification (General switch, ghost text, Tab/Right Arrow, Escape, a real-model suggestion) has not been performed; mock integration tests do not certify it.
- The branch-based release-impact gate passed: `@indexyz/dsh-prompt-suggestions: ok (intent added or modified)`.
