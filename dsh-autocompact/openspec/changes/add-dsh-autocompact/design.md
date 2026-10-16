# Design

## Context

See `proposal.md` for the motivation. The facts that shape the approach:

- The plugin is the dsh translation of `@indexyz/pi-autocompact`, and the two share a model: an earlier absolute threshold for one session and one model, keyed by the exact routed `provider/model`, with the command as the only writer of session state and configuration as the only source of deployment defaults.
- dsh's own compaction backend (`dsh-compaction-basic`) already condenses history as token pressure builds, using `floor(min(W × thresholdRatio, W − reservedOutput − headroomTokens))`. The public seam for anything earlier is `compactRegion(start, end, agent, signal)` on the mounted backend, which replaces the inclusive surface range `[start, end]` with a summary and writes the ordinary `compaction/*` records. The plugin does not summarize, does not write a synthetic prompt, and does not touch the backend's own threshold.
- The shipped Web bundle disables the Host-plane `compaction-basic` row and lets each Agent preset mount its own instance inside an `isolate` realm. A single Host row therefore cannot `inject` `compaction`; the plugin mounts on the Host plane (one row serves every preset) and resolves the backend of the exact agent at event time — `serviceForAgent(ctx, agent, "compaction")` from `@deepseek-ai/dsh-agent-preset-registry`, then `ctx.get("compaction")` for compositions (the headless, ACP, and SDK bundles) that mount it there.
- The host packages are pinned at `0.2.0-rc.2` (`@deepseek-ai/cordis` `4.0.4`, `@deepseek-ai/schemastery` `^3.18.4`), and the plugin imports `@deepseek-ai/dsh-compaction` for `toolPairingBalancedBefore`, `@deepseek-ai/dsh-session` for the surface types, and `@deepseek-ai/dsh-token-meter` for the measurement type.
- The Host `settings` service lists only a bundle row whose `Config` declares a volatile field, and accepts writes only to volatile paths; a volatile field is also what makes a saved edit visible to the running plugin without a restart. The client reaches that namespace as its own Cordis service (`remote.settings`, declared in `inject`): Cordis resolves a nested service only for a context that declares it, and reading it off the `remote` service otherwise throws — a throw while the section renders retires the whole slot entry.
- The page is a modal owned by the settings shell, and its store is not exposed to plugins. The shell registers a store seat through the slot registry with a handle pinned to the live instance (`{ ...handle, create: () => instance }`), so resolving that seat and calling its `openSection(id)` reaches the store the panel renders from. A store declared any other way mints a fresh, unsubscribed instance whose actions change nothing on screen, which is why the lookup checks the action table for `openSection` before asking.
- The client artifact is fetched by the Harness page's own module loader: `client.js` must be one `window.__ModuleLoader__.load({ id, factory })` registration whose factory body is ordinary CommonJS, with `react` and `react/jsx-runtime` provided by the page's module table. `tsdown` writes that wrapper around its CJS output into `client.js` next to `package.json`, and the file is committed because the working profile installs the package directory as a `link:` dependency (`"@indexyz/dsh-autocompact": "link:/home/coder/dsh-agent-extensions/dsh-autocompact"` today).
- The two halves are one package and, per the repository-wide change, one release candidate: `lib/` and `client.js` are inside `files`, so any change to them is published content that needs a release decision.

## Goals / Non-Goals

**Goals:**

- The session command, the pressure check, the Settings section, and the composer pill behave exactly as the working plugin does today, at parity with `@indexyz/pi-autocompact` where the hosts allow it.
- Both halves build from one checkout into artifacts the two hosts load as they are, with no build step at install time.
- Every failure mode leaves the session usable: no aborted turn, no clobbered configuration, no empty Settings page, no composer row taken down by a decorative widget.
- The package is verifiable before it is uploaded: unit tests for both halves, a release smoke check that evaluates the installed tarball, and a live profile install.

**Non-Goals:**

- Writing configuration from the command, persisting session overrides, or showing a session override on the client. Session overrides live in Host memory for one session by design.
- Replacing the backend's own compaction, disabling it, or adding a second summarizer. The plugin changes only when compaction starts.
- Editing `retainTokens` from the UI (it stays YAML configuration) or adding a threshold for a model the router does not report.
- Any new Harness API surface, any import of a Harness client package, or any change to the six Pi packages.

## Decisions

### 1. One Host-plane row, resolved per agent at event time

**Choice:** `inject` names only `commands`, `tokenMeter`, and `llm`. The backend comes from `serviceForAgent(ctx, agent, "compaction")` first and `ctx.get("compaction")` second, inside a `try` that treats a torn-down scope as absent.

**Why:** the shipped Web bundle mounts compaction per Agent preset in an isolated realm, so a `compaction` injection on the Host row would never resolve; a preset-only row would need one registration per preset revision. Addressing the exact agent at event time keeps one row working for every preset and every composition, and overrides stay keyed by session and route, so they follow the agent, not the preset revision.

### 2. Session state is a `WeakMap` keyed by the session object

**Choice:** overrides (`Map<string, number | null>`) and the once-per-session warning set live in a `WeakMap<Session, SessionState>`. `off` stores an explicit `null` (suppressing a global default), `default` deletes the key, and a threshold stores the parsed count. A new, resumed, or forked session starts clean, and a detached session is collected.

**Why:** the command is documented as session-only, and the key is the exact `provider/model` route, so switching models preserves each model's override. Nothing is written to configuration, the session log, or the model's metadata, which is what makes the command safe to run mid-conversation.

### 3. The threshold is an absolute count validated against the route's real capacity

**Choice:** `parseLimit` accepts `300k`, `0.3m`, or `300000` with decimal units and rejects anything that is not a positive safe integer; `resolveLimit` gives a session override precedence over the configured default, including the explicit `off`; `validateLimit` requires the value to be greater than the retained-tail budget the backend will keep verbatim and strictly less than the real context window. The retained tail comes from `nativeRetainTokens`, which mirrors the backend's own `resolveCompactSpec`: an exact `provider/model` policy wins, then the backend default (`retainTokens` or a `retainRatio` of the message budget), and the plugin's `retainTokens` fallback applies only when the backend publishes no usable policy. `defaultLimits` validates every configured entry at load, so a bad row fails loudly instead of at the first measured step.

**Why:** the backend replaces a range with a summary and keeps the tail verbatim, so a threshold at or below the tail cannot shrink anything, and one at or above the window can never trigger. Validating both is what lets the command promise that an accepted threshold has an effect.

### 4. The pressure check compacts an explicit balanced range and contains its own failures

**Choice:** on every `agent/pre-step`, after the master switch, the route, the effective threshold, and the backend have all been resolved, the plugin measures the session with `ctx.tokenMeter.measure` and only acts when `totalTokens > limit`. It then requires `compactRegion` (a backend without it is warned about once per session), resolves the context window through `ctx.llm.resolveModelInfo`, validates the threshold, selects the range with `selectCompactableRange` (first non-system surface node through the node before the retained tail, snapped back to a balanced tool-calling pair via `toolPairingBalancedBefore`), and calls `backend.compactRegion(range.start, range.end, agent, signal)`. Anything the surface or the summary throws is caught; the hook always calls `next()`.

**Why:** a new prompt enters through the same boundary, so a large existing session is compacted before its next request without a second code path. Containing failures means a summary error leaves context intact and the next step can try again, and never aborting the turn is the difference between an early compaction and a broken session. `undefined` from the range selector (too small a surface or one indivisible oversized message) leaves the decision to the backend's overflow or manual compaction.

### 5. The Settings section is the editor; the pill is a reading in the composer's row

**Choice:** one editor component and one config store serve two surfaces — the `settings.section` entry (id `@indexyz/dsh-autocompact`, order 25, labeled from the dictionary) and a central `main` panel under the same key. The store reads the row with `remote.settings.describe()` and writes it with `settings.update`/`settings.mutate(ns, ops, revision)`; `modelLimits` and `enabled` are declared `.volatile()` so the service lists the row and saved edits reach the running plugin. A `settings/conflict` response reloads the current values and says so; `writable: false` renders read-only; an absent row, a missing namespace, and a thrown request each render their own state. The pill reads `modelSelection` and `contextPressure` through the row's projections, subscribes to the same store so a save updates it immediately, and renders nothing while the row is absent or the model has no threshold.

**Why:** Settings owns the panel and its navigation, so the editor belongs there and the pill belongs in the composer's ambient row beside the session's own turn, token, and context readings. Sharing the store is what makes a Save visible in the pill without a second round trip. Rendering nothing for an unconfigured model keeps a decorative widget out of a row the session's own readings share; an explicit `off` is a deliberate choice and is reported for every model.

### 6. Navigation goes by capability, with a fallback panel

**Choice:** a click first tries `openSettingsSection`: read the entries of the settings shell's slot cell (`sidebar.settings`), and for each entry whose store declares `openSection` in its action table, create the instance and call `openSection(NS)`. Only if no store answered does it call `layout.selectPanel(NS)` for the plugin's own central panel. Both calls are wrapped so a throw from either cannot take down the composer row.

**Why:** the shell's store seat is pinned to the live instance, so resolving it reaches the very store the panel renders from, while a store declared any other way would mint an unsubscribed instance and the call would change nothing on screen — hence the action-table check rather than a positional guess. The central panel exists so a composition without the settings shell still has a destination; when neither is present the click is inert and the reading still renders.

### 7. Strings, theming, and the client's imports

**Choice:** the client half ships English and Chinese dictionaries under the plugin's namespace and binds them with `ctx.locale.bind(NS)`; its styles are built from host theme tokens, using the documented token as a fallback where the Theme provider does not publish one; and it imports nothing but `react` and its own relative modules. `tsdown` keeps `react` and `react/jsx-runtime` external in the committed bundle.

**Why:** the page must look like the host's other Settings sections and survive a token rename by degrading rather than erasing; a shipped string table is what makes the section and the pill readable in both locales; and importing a Harness client package would either duplicate the page's modules (inlined into the bundle) or break the module table's contract, since the loader's `require` provides only the page's baseline modules.

### 8. Verification has three layers

**Choice:** 65 Vitest cases in four files (`test/index.test.ts`, `test/compaction.test.ts`, `test/settings.test.ts`, `test/client.test.ts`) exercise the command, the range selection, the threshold grammar and defaults, and the client's pure state, store, and rendering; `test/smoke-release.ts` is the package's declared release smoke check (`release.smoke` in `package.json`), run by the release engine against the installed tarball; and a live `link:` install into the `web` profile exercises the command, the Settings section, and the pill in the real page.

**Why:** unit tests cannot prove that the committed `client.js` registers with the loader or that `exports` resolves inside a packed tarball; the smoke check evaluates the installed artifact exactly as the page does, and the live install is the only way to see the slot entries, the modal, and the ambient row. The smoke check lives in `test/`, which the `files` allowlist excludes, and `vitest.config.ts` runs only `test/**/*.test.ts`, so it is neither shipped nor run as a unit test — it is typechecked by the package's own `tsc --noEmit`.

### 9. The first version ships as `0.1.0` with a `none` intent

**Choice:** the package starts at `0.1.0` with a `## 0.1.0` changelog section, and the change records a hand-written `.changeset/<id>.md` naming `@indexyz/dsh-autocompact` with `none` and the reason: the package ships as its own first version, which the plan publishes because it is absent from npm, so no bump is needed.

**Why:** the plan publishes any absent version, so a positive intent would bump `0.1.0` to `0.1.1` and publish a version nobody wrote notes for, while no intent at all would fail the release-impact gate. `none` is the honest decision and it keeps the version the package intends to debut with. The first upload itself is the owner's bootstrap, because npm binds a trusted publisher in an existing package's settings.

## Risks / Trade-offs

- **The threshold does not cap a request** → one turn or one tool batch can overshoot it. Documented in the README; the range selection and the backend's own threshold remain the safety net.
- **The pill shows the deployment default, not the session's effective value** → session overrides live in Host memory and are not published to the client, so the pill deliberately reports the persisted threshold and does not claim to be the effective one. Making overrides visible would need a new Host-to-client channel; left as an open question.
- **Summary generation costs model tokens and can fail** → failures are contained, warned about once per session, and not retried at the same boundary; a later step can try again. The README says so.
- **`compactRegion` is newer than the backend shipped by some compositions** → the command reports the missing capability and the hook goes inert, rather than guessing at an older API. `0.2.0-rc.2` ships it.
- **The generated `client.js` is committed** → it can drift from `src/client/`. The root `check` builds before the tests, the package's `check` builds before its tests, and the release smoke check evaluates the packaged artifact, so a bundle that no longer registers fails before upload; the file also carries a generated-file header and is skipped by the root linter and formatter.
- **Two surfaces share one editor** → a change to the page component reaches both. Accepted: one store, one editor, and the pill's fallback stays consistent by construction.
- **An isolated realm can tear down mid-check** → `backendFor` and every client accessor (`clientService`, `settingsFace`, `layoutFace`) tolerate absence and return `undefined` instead of throwing, because a throw in the row or the section would retire the slot entry.
- **The first upload cannot come from CI** → the owner publishes the verified tarball once and adds the trusted publisher; every later version publishes normally. This is the documented bootstrap for every new package, not a property of this one.

## Migration Plan

1. Land this change together with `support-dsh-packages`: the package directory, its `workspaces` entry, its release intent, and the engine's declared smoke check. The engine reads `release.smoke` from the manifest at the version commit, so the field and the script must be in the same commit as the package.
2. Verify from the repository root: `npm run check` (root format, lint, typecheck, the workspace build, every package's tests, and the release-script tests), then `node scripts/release/plan.ts --dry-run`, which must build `@indexyz/dsh-autocompact@0.1.0`, inspect the tarball, install it into an empty directory, and pass it through `node dsh-autocompact/test/smoke-release.ts <installed-package-dir>`.
3. Verify live: point a profile at the checkout with a `link:` install (`dsh plugin --profile web add ./dsh-autocompact`, replacing the current `link:` to `dsh-agent-extensions`), boot `dsh web`, and exercise `/autocompact 300k`, `/autocompact off`, `/autocompact default`, a threshold that crosses during a long session, the Settings section's save/conflict/read-only paths, and the pill's click.
4. After merging, the owner performs the bootstrap for `@indexyz/dsh-autocompact@0.1.0` (`docs/releases.md`, "First release of a new package"); the rerun records the tag and GitHub Release.
5. The old copy in `dsh-agent-extensions` is removed there, with its workspace entry and scripts, so only one copy publishes.

## Open Questions

- Whether to publish session overrides to the client so the pill can show the effective value next to the deployment default. It would need a Host-to-client projection the plugin does not have today.
- Whether a second dsh package should share a small helper for the loader-contract part of `test/smoke-release.ts`. One copy does not justify one.
