# Proposal

## Why

The user directive "不要在项目中使用任何 mock 进行测试，使用真实的环境进行测试" contradicts the repository's current testing style: package tests today drive their host through hand-rolled fakes (`fakeSettings`, `mockLlm`, `fakeFetch`), Vitest module/global replacements (`vi.mock`, `vi.stubGlobal("fetch", …)`, `vi.spyOn`/`vi.mocked`), and hand-written browser stubs (`__ModuleLoader__`, `ComponentStub`, `createElement` shims in `runInNewContext`, plus `vi.mock("@deepseek-ai/dsh-client-ui-primitives")`). Those tests can pass while the real host rejects the package — exactly the failure mode the 0.2.2-alpha.2 audit just exposed: `SessionTitleService`'s `inject` list gained `"agents"`, the fixture kept a fake-only plane, and four tests failed _after_ pins moved because the real plane, not a stub, decides what `ctx.sessionTitle` becomes.

## What Changes

- **BREAKING (testing policy):** every package's tests must run against the **real host environment** of its pinned host line, never a mock of it. The repository already does this in places (`pi-skill/test/extension-load.test.ts` imports Pi's real loader; `dsh-thread-summary/test/host-integration.test.ts` mounts the real service graph; the e2e runner packs, installs, and smokes each dsh tarball) — the policy makes that the requirement everywhere, and the audit counts roughly 45–50 of the 54 tracked test files across all 10 packages that still build a host out of mocks.
- **Real host planes replace fakes.** DSH plugins get a real service graph from the pinned 0.2.2-alpha.2 closure (`ctx.plugin` of real `@deepseek-ai/dsh-*` packages, real `sessionLog`/`Session`/`SessionTitleService`/`AgentRegistry`, real settings/filesystem), and Pi packages get Pi's real extension loader (`loadExtensions` with an isolated `PI_CODING_AGENT_DIR`) and real provider-registration path.
- **Client halves get a real browser environment.** `client.js` artifacts load in a real DOM (jsdom, already a dev dependency of the three packages with a client half) against the **real** `@deepseek-ai/dsh-client-ui-primitives` — already pinned at `0.2.2-alpha.2` in both client-half packages, and supplied by the 0.2.2 host closure through its `alpha` dist-tag — so the `vi.mock` of it, the stub-React `createElement`/`ComponentStub` harnesses, and the `runInNewContext` + `__ModuleLoader__` shims retire against the real browser half.
- **Network-shaped code gets a real network client.** Where tests currently stub `fetch`, the converted test starts a **real local server** (`node:http`) and exercises the real fetch/undici path — no credentials needed for local-server behaviour, and the real-endpoint case is only what credentials cannot be held offline.
- **Real model calls where a credential exists.** Tests call the real dsh-llm / pi-ai stack, reading the model from the settings under test. A live endpoint needs a key: OpenCode Zen's keyless `/zen/v1/models` returns 200 but chat/completions returns `401 AuthError: Missing API key`, so the free-tier Zen route still needs an API key (a repo secret the owner must grant, or a local run). **Blocked, recorded:** no model-call conversion lands until a key route is confirmed.
- **`pi-provider-sub2api`'s live-endpoint tests are deferred** by explicit user decision ("sub2api 可以先不实际测试"); they stay stubbed until that package is converted.
- **Policy lands in the instruction surface + docs + OpenSpec** (AGENTS.md "Tests" rule, `docs/workflow.md`), because the rule is repository-wide (it changes how every package verifies, not one package's behaviour) and touches shared tooling.
- **No published content changes.** `test/` appears in no package's `files` allowlist (verified: `dsh-autocompact` ships `lib`, `src`, `client.js`, `cordis.patch.yml`, README/CHANGELOG/LICENSE; `pi-skill` ships `index.ts`, README, CHANGELOG, LICENSE), so **test-only conversions need no release intent**; only a conversion that must add a real-host package to a manifest (`@deepseek-ai/dsh-client-ui-primitives` dev pin + `"*"` peer, rule 3) carries a `patch` intent for that package.

## Capabilities

### New Capabilities

- `real-environment-testing`: what a package's tests must load and run through — the real host plane, the real browser plane, the real network client, and a real endpoint when a credential is available — so that a passing test means the real host accepted the package.

### Modified Capabilities

### Modified Capabilities

- `agent-guidance`: the instruction surface gains the testing rule (that the real-environment requirement is what every package's verification must load). The capability is introduced by the pending `support-dsh-packages` change and `openspec/specs/agent-guidance/spec.md` does not exist yet — same base, so this change writes its share as additions, like that change did.

## Impact

- **Root:** `AGENTS.md` (one new rule in the "Tests" area of `docs/conventions.md` plus rule 5 pointer), `docs/workflow.md` ("Verify" section: what a real-environment test run must load), `openspec/config.yaml` untouched; one new root spec.
- **Packages (test trees only):** ~45–50 tracked `.ts` files under `*/test/` across all 10 packages rewritten (all but `pi-model-trace`, whose tests are already pure-logic); `pi-provider-sub2api` deferred.
- **Manifests:** none. Both client-half packages already pin `@deepseek-ai/dsh-client-ui-primitives` at `0.2.2-alpha.2` in `devDependencies` with peer `"*"` (rule 3 already satisfied — the 0.2.2 host closure itself supplies it through its own `alpha` dist-tag), so every conversion stays inside `test/` trees: **no package's published content changes → no release intent for any package**, and the root `check` gate is unaffected by manifest churn.
- **CI/verification:** `npm run check` and `npm run test:e2e` stay the gate; the e2e runner's isolated install becomes the real host-closure install. Credential-gated model tests are the only part CI cannot run today (recorded as blocked, not silent).
