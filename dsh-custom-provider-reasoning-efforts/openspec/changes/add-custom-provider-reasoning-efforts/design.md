# Design

## 1. The gap is configuration, not code

**Choice:** the plugin supplies the missing `reasoningEfforts` by writing the `llm-pi-ai` row's `providers` configuration through the `settings` service; it does not register an adapter, wrap the `llm` service, or patch anything in memory.

**Why:** the resolution chain reads `entry.reasoningEfforts` from the `llm-pi-ai` profile and only falls back to the installed catalog when the field is absent. A hand-written route has no catalog entry, so the field is the whole fix — and the profile is the only place it can come from. Every other seam is closed:

- `LlmRuntime.registerAdapter()` throws `DUPLICATE_ADAPTER` for a route another registration already owns, so the plugin cannot take over `magpie` (or any catalog-served route) to attach metadata.
- The only `llm` waterfall is `llm/stream`, which runs after model selection and has no bearing on `resolveModelInfo`.
- `providers` is declared `.volatile()` on the `llm-pi-ai` `Config`, so a write through the settings service commits into the running fiber and emits `loader/volatile-update`, which is exactly how the adapter re-registers its routes and how a Models-page save already reaches a running plugin. No restart is involved.
- The bundle-patch alternative cannot work: `applyEntryPatches` assigns `target.config = value` wholesale, so a lower layer's `llm-pi-ai` config is replaced by the profile's, not merged into it.

## 2. Declarations live in this plugin's own row

**Choice:** the declaration table is the plugin's own `config.providers`, keyed first by route and then by model id, with each model's value either an effort dict or `false`; the plugin's row is ordinary (non-volatile) configuration edited in YAML.

**Why:** the plugin is the declaration's owner and the user's single place to state it; writing the declarations straight into the `llm-pi-ai` row is the _output_, not the input. Ordinary config means the row is not listed as a settings form (this package has no settings UI), and the loader validates it at mount. A declaration is validated semantically before it is ever written — empty dicts, an `off`-only dict, a `null` wire value on a thinking level, an empty wire spelling, and a key that is not a pi-ai thinking level all fail the load with the route, model, and level named, instead of surfacing later as a provider-resolution failure inside `llm-pi-ai`.

## 3. The write is a lean update of the profile's own providers value

**Choice:** `apply` reads `settings.describe()`, takes the `llm-pi-ai` descriptor's `user` (the profile patch's own raw `providers`) as the base, merges only the declared fields into a clone of it, and calls `settings.update(ns, { providers: next }, descriptor.revision)`. `status` is the same computation with `dryRun`.

**Why:** `describe().value` is the _resolved_ config — every provider default materialized — so writing it back would bloat the profile with fields the user never wrote. `describe().user` is the lean layer the profile actually carries, which is also what the Models page edits. Passing the whole `providers` object (rather than path ops) keeps the merge idempotent and independent of array indexing, and `settings.update` merges it over the current layer, preserves the row's ordinary config, and validates the candidate through the Loader before writing. The write happens only when the plan reports a real change, so a second boot does not rewrite the file; a revision conflict is retried once against a fresh `describe()`.

## 4. Explicit declarations win, and nothing is invented

**Choice:** an explicit declaration always overrides a discovered one for the same route/model, and the plugin only touches models the profile already declares on that route. A declared route the profile does not carry, or a declared model the route does not list, is reported and skipped.

**Why:** the user's declaration is the authority; discovery is a convenience that may be stale or wrong. Inventing a route or a model would mean inventing `baseURL`, `api`, and credential semantics the plugin has no business guessing, and would turn a metadata fix into a provider-configuration generator. The skip list is part of the command's answer so a declaration that cannot land says why.

## 5. Load-time work never races or masks boot

**Choice:** with `applyOnLoad` on, the pass runs after startup: through the launcher's `appReady.onReady()` when the composition provides it, and otherwise with a bounded retry (six attempts, 100 ms apart) that stops at the first pass whose namespace is reachable. It runs asynchronously, catches every failure, and logs instead of throwing.

**Why:** `configEditor.edit()` takes the profile's file lock and reconciles the Loader, which must not happen while the tree is still mounting, and startup must not fail because an unreachable gateway rejected a probe. The retry exists because the Loader mounts a profile's entries concurrently, so a fallback composition can see the `settings` service before the `llm-pi-ai` entry's fiber is active; the standard launcher always provides `appReady`, which fires once the whole tree has booted, so the retry only covers embedded hosts and tests. `appReady` is the launcher's documented signal for "lifecycle work that must not mask boot failure"; a composition without a launcher signal (a test harness, an embedded host) still gets the pass, just without the extra ordering guarantee.

## 6. Discovery mirrors the Harness's own listing semantics

**Choice:** the probe reuses the shipped discovery contract rather than inventing one: OpenAI protocols list at `{baseURL}/models` with `authorization: Bearer`, Anthropic Messages at `{root}/v1/models?limit=1000` with `x-api-key` and `anthropic-version`, the `data` array or `models` map is read, entries without a usable id are skipped, and `attributionHeaders()` is sent on every request. Reasoning is read from `supported_reasoning_levels`, `reasoning_levels`, `supported_reasoning_efforts`, or a `reasoning` object's `efforts`/`supported_efforts`, with string entries or `{effort}`/`{level}`/`{id}`/`{name}` objects; a name that is a pi-ai thinking level maps to itself as its wire spelling, `off` maps to `null`, and a model that advertises no thinking level yields no declaration.

**Why:** the Harness already decided what a provider listing looks like and how it authenticates; matching it means a deployment's working discovery keeps working here, and the level names a gateway publishes are the names it accepts, so identity is the only wire mapping that can be derived without guessing. Anything a gateway spells differently is still expressible as an explicit declaration. Candidates are the routes whose profile declares an explicit `models` list and a `baseURL` — the shape of a hand-written route — and `discoverRoutes` overrides that heuristic when a deployment wants otherwise.

## 7. Verification has three layers

**Choice:** Vitest covers the pure declaration, planning, parsing, and discovery logic plus the settings write and the plugin's command and load-time wiring against fakes shaped like the Harness; `test/smoke-release.ts` is the declared release check and inspects the installed tarball; and a live profile install exercises the command and the model-selection menu.

**Why:** the defect is a chain of Harness internals, so the tests must pin the shape the plugin depends on — the descriptor's `ns`/`revision`/`user`/`value`, the plan's skip reasons, and the exact request a probe makes — without a running Harness. The smoke check proves the packaged manifest targets, the built host entry, and the bundle patch survive packing, which a unit test cannot. The live install is the only proof that a save lands live in the running adapter and that the menu lists the levels.

## 8. The first version ships as `0.1.0` with a `none` intent

**Choice:** the package starts at `0.1.0` with a `## 0.1.0` changelog section, and the change records a hand-written `.changeset/<id>.md` naming `@indexyz/dsh-custom-provider-reasoning-efforts` with `none` and the reason that the plan publishes an absent version, so no bump is needed.

**Why:** a positive intent would bump `0.1.0` to `0.1.1` and publish a version nobody wrote notes for, while no intent at all would fail the release-impact gate. The first upload itself is the owner's bootstrap, because npm binds a trusted publisher in an existing package's settings.

## Risks / Trade-offs

- **The write touches another plugin's configuration** → `settings.update` is the sanctioned path (the Models page writes the same field), the change is limited to fields the profile already declares, and the plan reports the skips. A deployment that removes the plugin keeps the declarations, which is the intent; `/reasoning-efforts clear` is the way back.
- **Re-serializing the profile patch loses comments inside the `llm-pi-ai` config node** → the Loader's own editor rewrites that node on any settings write, including a Models-page save; the plugin writes only when it changes something, so this happens at most once per change.
- **Discovery is a network request at startup** → it is deferred past readiness, per-route, timeout-bounded, and contained to a warning; `discover: false` turns it off, and a deployment with no resolvable credential probes unauthenticated rather than failing.
- **A gateway's level names may not be its wire spellings** → identity mapping is the only derivable answer; `reasoningEfforts` accepts explicit wire values for the cases it misses.
- **A route that advertises only `reasoning: true` and no levels stays as it is** → there is no level to offer, and guessing one would claim a capability the gateway did not declare.
- **The first upload cannot come from CI** → the owner publishes the verified tarball once and adds its trusted publisher; every later version publishes normally.

## Migration Plan

1. Land the package directory, its `workspaces` entry, its root README row, and its release intent together.
2. Verify from the repository root: `npm run check`, then the package's own smoke check against a real install (`npm run build --workspace @indexyz/dsh-custom-provider-reasoning-efforts` and `node dsh-custom-provider-reasoning-efforts/test/smoke-release.ts dsh-custom-provider-reasoning-efforts`).
3. Verify live: install the checkout into a profile (`dsh plugin --profile web add ./dsh-custom-provider-reasoning-efforts`), boot the Harness, and confirm the declared route's models list their levels in the model-selection menu after `/reasoning-efforts discover`.
4. After merging, the owner performs the bootstrap for `@indexyz/dsh-custom-provider-reasoning-efforts@0.1.0` (`docs/releases.md`, "First release of a new package").

## Open Questions

- Whether a Settings page for the declarations is worth a browser half. The host half already exposes everything a page would need (the descriptor read, the plan, and the applied/skipped result), so this can be added without changing the write path.
- Whether a route whose gateway advertises `reasoning: true` with no levels should get a documented fallback set (`low`/`medium`/`high`). Left out: it would claim levels the endpoint did not declare.
