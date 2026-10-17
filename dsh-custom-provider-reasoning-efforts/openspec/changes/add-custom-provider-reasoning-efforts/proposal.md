# Proposal

## Why

A provider route the installed pi-ai catalog does not ship — a hand-written `llm-pi-ai` route such as this deployment's `magpie` — has no catalog entry to inherit reasoning capability from. `resolveModelReasoning(entry, base)` falls back to `base?.reasoning ?? false`, so with `base === undefined` every model on that route resolves to `reasoning: false`; `reasoningInfo(model)` then returns `{}` and the model-selection menu has no levels to offer ("no reasoning levels are available for this model"). The gateway itself declares the capability (`reasoning: true` and `supported_reasoning_levels: [{effort: "low"}, {effort: "high"}, {effort: "max"}]`), but the Harness endpoint probe parses only `id`/`name`/`contextWindow`/`maxTokens` and never persists its result, so discovery cannot fill the gap either.

The fix the `llm-pi-ai` configuration already supports is an explicit `reasoningEfforts` declaration on every model entry of such a route: a declared dict becomes pi-ai's `thinkingLevelMap`, with undeclared levels pinned to unsupported. Nothing in the Harness can supply that field on behalf of another plugin except the configuration seam the Models page itself writes through: `ctx.settings.describe()` / `update()` over the `llm-pi-ai` row's `volatile` `providers` field. This change adds a plugin that owns exactly that: it takes declarations (and, for routes whose gateway advertises them, discovered levels) and writes the missing `reasoningEfforts` into the `llm-pi-ai` profile configuration, live and without a restart.

## What Changes

- **The package `dsh-custom-provider-reasoning-efforts/`**, published as `@indexyz/dsh-custom-provider-reasoning-efforts`: a host-only dsh package (`dsh.bundle.patch` at `cordis.patch.yml`, no `dsh.client` and no browser half), `main`/`types`/`exports` at the built `lib/`, `files` shipping `lib`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, and `LICENSE`, its own `tsconfig.json`, `tsconfig.build.json`, and `vitest.config.ts`, and `release.smoke` at `test/smoke-release.ts`.
- **Declarations in the plugin's own row config**: `providers` maps a route to its models and each model to the pi-ai thinking levels it offers, with each level's wire spelling (`{low: low, high: high, max: max}`) or `false` for a non-reasoning model. The declarations are validated at load and fail loudly, naming the route, model, and level at fault.
- **The write path**: the plugin reads the `llm-pi-ai` entry through the `settings` service, locates each declared model in the profile's own `providers` configuration, and writes only the missing `reasoningEfforts` fields back with `settings.update()` guarded by the row revision. Only models the profile already declares can be filled; a route or model the profile does not carry is reported and skipped rather than invented. Because `providers` is `volatile`, the write reaches the running `llm-pi-ai` adapter without a restart, so the resolution chain and the model-selection menu pick the levels up immediately.
- **Endpoint discovery**: `/reasoning-efforts discover` (and the load-time pass when `discover` is on) interrogates each custom route's `/v1/models`, and — for a Codex-shaped relay that publishes no capability there — the backend's own capability manifest at the route root's `/backend-api/codex/models`, the second source `pi-provider-sub2api` reads for the same relays with the route's own `baseURL`, protocol, headers, and `apiKeyEnv` credential — bearer for OpenAI protocols, `x-api-key` plus `anthropic-version` for Anthropic Messages — and maps `reasoning: true` together with `supported_reasoning_levels` / `supported_reasoning_efforts` (string or `{effort}` entries) to a declaration, and merges a manifest's `models[].supported_reasoning_levels` into a listing that described nothing. An explicit declaration always wins over a discovered one; a route that advertises no levels is left alone.
- **The `/reasoning-efforts` command** with `status` (the default; plans without writing), `apply` (explicit declarations only), `discover` (probe, then apply explicit and discovered), and `clear` (remove the `reasoningEfforts` the declarations name), reporting what changed, what was already current, and what was skipped and why.
- **Verification**: Vitest cases for declaration validation, endpoint parsing, discovery requests, the plan against a profile-shaped input, the settings write including its conflict retry, and the plugin's command and load-time behavior against a fake Harness; plus the declared release smoke check, which inspects the installed tarball's manifest targets, its built host entry, and its bundle patch.
- **Release intent**: a hand-written `.changeset/dsh-custom-provider-reasoning-efforts-first-version.md` naming `@indexyz/dsh-custom-provider-reasoning-efforts` with `none`, because the package ships as its own first version `0.1.0`, which the plan publishes because it is absent from npm, so no bump is needed.

## Capabilities

### New Capabilities

- `reasoning-efforts-declarations`: the declaration model in the plugin's row config, the levels it accepts, how a declaration is validated, how it is planned against the `llm-pi-ai` profile's own `providers` value, and how it is written through the settings service.
- `reasoning-efforts-discovery`: the endpoint interrogation of custom routes — route selection, request construction and authentication, the response shapes read, the levels mapped, and how every failure is contained; plus the `/reasoning-efforts` command's modes and load-time pass.
- `reasoning-efforts-package`: the package as a published artifact — manifest, host build and its committed output, the bundle patch row, the test suite and release smoke check, the live profile install, and the release decision.

### Modified Capabilities

None; this is the first change in `dsh-custom-provider-reasoning-efforts/openspec/` and it has no main specs yet.

## Impact

- **New files:** `dsh-custom-provider-reasoning-efforts/` in full — `package.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `cordis.patch.yml`, the host half (`index.ts`, `levels.ts`, `declarations.ts`, `reasoning.ts`, `discovery.ts`, `plan.ts`, `apply.ts`, `runtime.ts`), the built `lib/`, the tests under `test/` including `test/smoke-release.ts`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, and `openspec/`.
- **Root:** the `dsh-custom-provider-reasoning-efforts` entry in `workspaces`, a row in the root `README.md` package table, and the release intent file under `.changeset/`; the root `pi.extensions` does not list it.
- **Runtime surface touched:** the `llm-pi-ai` row's `providers` configuration (its `volatile` field), the only seam through which a plugin can supply model metadata the resolution chain reads. `providers` is written through `ctx.settings`, never by editing files directly, so the Loader reconciles the change exactly as it does a Models-page save.
- **Existing defect addressed:** every model on a hand-written provider route can carry `reasoningEfforts`, so `resolveModelReasoning` stops returning `reasoning: false` and the model-selection menu lists the route's levels.
