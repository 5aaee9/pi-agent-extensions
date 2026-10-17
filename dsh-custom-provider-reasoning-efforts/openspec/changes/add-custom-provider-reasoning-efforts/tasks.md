# Tasks

## 1. Package skeleton and manifest

- [x] 1.1 Create `dsh-custom-provider-reasoning-efforts/` with `package.json` (`@indexyz/dsh-custom-provider-reasoning-efforts`, version `0.1.0`, the repository `homepage`/`bugs`/`repository` fields, `publishConfig.access` `public`, `engines.node` `>=22.19.0`, `engines.dsh` `>=0.2.0-rc.2 <0.3.0-0`), `LICENSE` (copied from the repository root), `README.md`, `CHANGELOG.md` with a `## 0.1.0` section, `cordis.patch.yml` (a bundle patch layer inserting the row `custom-provider-reasoning-efforts` with `config.providers: {}`), `tsconfig.json` (strict, `noEmit`, `test/**/*.ts` included), `tsconfig.build.json` (host half only, `outDir` `lib`, declarations, declaration and source maps, `rewriteRelativeImportExtensions`), and `vitest.config.ts`
- [x] 1.2 Declare the manifest: `dsh.bundle.patch` `./cordis.patch.yml` and no `dsh.client`; `main` `lib/index.js`, `types` `lib/index.d.ts`, `exports` for `.` and `./package.json`; a `files` allowlist of `lib`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, and `LICENSE`; no `pi` manifest
- [x] 1.3 Declare the scripts (`build` = `build:host`, `build:host` = `tsc -p tsconfig.build.json`, `test`, `test:watch`, `typecheck` = `tsc --noEmit`, `check` = `typecheck && build && test`, `prepack` = `check`) and the dependencies: `@deepseek-ai/cordis` `4.0.5`, `@deepseek-ai/schemastery` `^3.18.4`, and `@deepseek-ai/dsh-commands`, `dsh-llm`, `dsh-settings` at `0.2.0-rc.2` in `devDependencies` with `"*"` peers, plus `typescript`, `vitest`, and `@types/node`
- [x] 1.4 Declare `release.smoke` as `test/smoke-release.ts` in `package.json`
- [x] 1.5 Create the package OpenSpec root (`openspec/config.yaml`, `openspec/specs/.gitkeep`, `openspec/changes/archive/.gitkeep`) and propose this change there; add the directory to the root `workspaces` and run `npm install` from the repository root

## 2. Declaration model

- [x] 2.1 Implement `levels.ts`: the pi-ai thinking levels in escalation order, the level type, and the level predicate
- [x] 2.2 Implement `declarations.ts`: the `Efforts`, `ModelDeclaration`, and `Declarations` shapes, the semantic validation that names the route/model/level at fault (empty dict, off-only dict, `null` on a non-`off` level, empty wire spelling, unknown level key, empty route or model table), and `describeEfforts`
- [x] 2.3 Test the declaration model in `test/declarations.test.ts`: every accepted shape and every rejection with its message

## 3. Endpoint discovery

- [x] 3.1 Implement `reasoning.ts`: `readModelListing` over the `data` array or `models` object, and `levelNames`/`effortsOf` reading `supported_reasoning_levels`, `reasoning_levels`, `supported_reasoning_efforts`, and the `reasoning` object's `efforts`/`supported_efforts`, with string and `{effort|level|id|name}` entries, identity wire mapping, `off` to `null`, and no declaration for a model that advertises no level
- [x] 3.2 Implement `discovery.ts`: `listingUrl` per protocol, the request headers (attribution, accept, configured headers, bearer or `x-api-key` + `anthropic-version`), the bounded JSON read, and `probeRoute` returning the listing or a named failure
- [x] 3.3 Test both in `test/reasoning.test.ts` and `test/discovery.test.ts`: the observed gateway's `supported_reasoning_levels`, the `models`-map shape, every reasoning field spelling, unknown level names, `reasoning: true` with no levels, both protocols' URLs and headers, a non-2xx answer, a non-JSON answer, and an oversized answer

## 4. Planning and the settings write

- [x] 3.4 Implement the Codex capability manifest source in `reasoning.ts` and `discovery.ts`: `readManifestListing` over `models[].supported_reasoning_levels` keyed by `slug`, `manifestUrl` at the route root, `probeManifest` treating an absent endpoint as no manifest, and `hasCodexManifest` limiting it to the Responses protocol
- [x] 3.5 Test the manifest source in `test/discovery.test.ts` and `test/runtime.test.ts`: the URL, the level mapping, an absent endpoint, a failing endpoint, the unlevelled-model trigger, the merge precedence, and the protocol gate
- [x] 4.1 Implement `plan.ts`: `planProviders(user, intents)` cloning the profile's own `providers`, resolving each intent against the route's explicit `models` list by id, recording a change only when the value differs, and recording a skip with its reason for an absent route, a route without an explicit list, and an absent model
- [x] 4.2 Implement `apply.ts`: the `SettingsSeam`/`ProviderDescriptor` shapes, `applyIntents` with `dryRun`, the unavailable/read-only results, and the single conflict retry against a fresh descriptor
- [x] 4.3 Test both in `test/plan.test.ts` and `test/apply.test.ts`: the add/unchanged/remove/skip cases and the write/unchanged/dry-run/unavailable/conflict paths

## 5. Runtime and plugin wiring

- [x] 5.1 Implement `runtime.ts`: the candidate-route selection (explicit `models` + `baseURL`, or `discoverRoutes`), the credential resolution (credentials service then `process.env`), the intent merge where an explicit declaration wins, the per-route probe containment, and the command answer formatting for `status`, `apply`, `discover`, and `clear`
- [x] 5.2 Implement `index.ts`: the `name`/`inject`/`Config` exports, the `apply` that registers the `/reasoning-efforts` command and the load-time pass, the `appReady`-first ordering with the immediate fallback, and the contained logging
- [x] 5.3 Test the runtime and the wiring in `test/runtime.test.ts` and `test/index.test.ts`: route selection and overrides, the credential fallbacks, contained probe failure, the four command modes and the usage answer, the load-time pass with and without `appReady`, `discover: false`, `applyOnLoad: false`, and a malformed declaration failing `apply`

## 6. Release verification and decision

- [x] 6.1 Write `test/smoke-release.ts`: read the installed `package.json`, require the name, require every `main`/`exports` target, `lib/index.js`, and `cordis.patch.yml` to exist, require the bundle patch to insert exactly one row naming the package, and exit 0 with one line or non-zero with one line naming the invariant that broke; Node built-ins and erasable syntax only
- [x] 6.2 Build (`npm run build --workspace @indexyz/dsh-custom-provider-reasoning-efforts`), run the smoke check against the checkout, then verify it against a packed install with a broken copy of each invariant failing non-zero
- [x] 6.3 Finish `README.md` (what it fixes, install, declarations, the command, the configuration table, discovery, behavior and limitations, development) and `CHANGELOG.md` (`## 0.1.0`)
- [x] 6.4 Record the release decision: a hand-written `.changeset/dsh-custom-provider-reasoning-efforts-first-version.md` with `"@indexyz/dsh-custom-provider-reasoning-efforts": none` and the reason; add the root `README.md` row
- [x] 6.5 Run `npm run check` from the repository root and the release-impact gate; record the exact commands and results
- [ ] 6.6 Confirm the live result: `dsh plugin --profile web add /home/coder/pi-agent-extensions/dsh-custom-provider-reasoning-efforts` installed the package as a `link:` dependency and appended it to `dsh.profile.bundles` with its row config left empty, so the levels come from the load-time discovery pass rather than a hand-written declaration. What remains is the restart of `dsh web`, which loads the new row and lets the pass run, and the check that the model-selection menu then lists the route's levels
