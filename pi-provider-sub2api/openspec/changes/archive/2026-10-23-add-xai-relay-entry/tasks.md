# Tasks

All tasks below are implemented and verified; each checkbox reflects verified behavior. The release-impact gate in 4.4 waits for an authorized commit.

## 1. Pi 1.4.0 baseline and xAI entry

- [x] 1.0 Pin this package’s three Pi host devDependencies to exactly `1.4.0`, keep host peers at `"*"`, and refresh `package-lock.json` with npm. Update the README minimum to Pi 1.4.0 and this package’s row in `docs/pi-reference.md`; leave other workspace pins unchanged. Recheck the published 1.4.0 docs/types and changelog, adapt affected package code to that baseline, and verify resolved dependency versions plus the package typecheck/tests before adding the xAI path. Do not introduce earlier-host compatibility paths.
- [x] 1.1 Add the `api: "xai"` selector, keeping configured entry identity separate from the resolved `openai-responses` API. Verify config loading and extension registration with same-host entries using different credentials.
- [x] 1.2 Apply the xAI configuration contract for required fields, credential expressions, hosted-tool groups, and unsupported settings. Verify field-specific secret-free errors, accepted empty/null values, and unchanged validation for other entry types.
- [x] 1.3 Document the named Grok entry, dedicated key, URL normalization, and environment/command-token examples in the package README. Verify the examples through configuration loading and explain that the entry key is the provider ID.

## 2. Discovery and metadata

- [x] 2.1 Implement the `/v1/models` inventory and Grok media classification from the xai-relay spec. Verify extension registration with realistic server fixtures, prefixed media IDs, unfamiliar text aliases, invalid/duplicate IDs, and inventory failures.
- [x] 2.2 Restore xAI catalog capability fields and resolve limits, modalities, and scaled prices field by field. Verify remote/cache/bundled/default precedence, partial caches, exact-ID matching, output caps, and uniform defaults regardless of alias spelling. Verify `grok-4.6`/`grok-4.7` use the Pi 1.4.0 bundled capabilities and prices when remote/cache fields are absent, and test defaults separately with unknown IDs.
- [x] 2.3 Implement reasoning capability and bounded effort choices. Verify Pi’s registered supported levels for false/missing/true flags, empty/unknown/malformed arrays, secondary-list fallback, explicit `none`, catalog mappings, and reasoning without configurable effort.
- [x] 2.4 Document metadata precedence and gaps, default limit/price estimates, media filtering, and the no-override `off` state. Verify examples against the discovery fixtures and Pi 1.4.0 thinking-level behavior.

## 3. Requests and Pi integration

- [x] 3.1 Add the thin xAI wrapper around the public host Responses adapter. Verify actual serialized requests through that adapter: entry endpoint/token, supported or omitted effort, merged encrypted-reasoning include, `store: false`, callback composition, cancellation, response hooks, caller fetch, and redirect rejection. Verify unavailable host support rejects only xAI entries without a reduced-behavior fallback.
- [x] 3.2 Set the xAI long-retention policy and enforce the Grok cache-route opt-out after header merging. Verify both environment/request-level long settings omit the 24h retention field and caller opt-in cannot replace the opt-out. Exercise local `web_search` and `x_search` function calls/results plus encrypted replay through the delivered wrapper and host adapter with mocked external HTTP.
- [x] 3.3 Apply the session contract and xAI request-mode eligibility at existing integration points. Verify command rejection, inactive saved preferences, footer state, alias-independent behavior, cross-provider switching, and ordinary textual compaction through command/event handlers and requests. Other entry behavior must remain unchanged.
- [x] 3.4 Document request behavior, session limits, and the Free-account cache/cost trade-off. Verify any new runtime module is in the package files allowlist and TypeScript includes; update the root package table and record a release intent covering xAI support and the raised Pi minimum without editing the extension version. Confirm this feature adds no search tool or endpoint call.

## 4. Integrated acceptance

- [x] 4.1 Run root `npm run check` with the implementation installed. Record actual results; retain the existing regression checks without weakening rules or unrelated expected behavior.
- [x] 4.2 Run the RPC load smoke from `docs/workflow.md` using this package’s resolved Pi 1.4.0 binary with isolated multi-entry configuration. Verify the host version, model registration, and no load errors; a newer installed Pi can be checked additionally but cannot replace the 1.4.0 baseline.
- [x] 4.3 Exercise a real Grok-group key in Pi 1.4.0: reasoning turn, local-tool continuation, provider switching, quota/billing, supported and rejected commands, and `/compact`. Record redacted evidence and host/server/model versions. Missing access or unsolicited native-tool execution/events block this check; do not claim success without it.
- [x] 4.4 Run `openspec validate add-xai-relay-entry --strict` and reconcile implementation with both delta specs. Run the release-impact gate on the implementation branch once a commit is authorized; report any skipped check and its reason.

## Workflow follow-up

- After implementation and verification, sync/archive through OpenSpec and verify the resulting durable specs.
- Commits, version preparation, pushes, and publication require their own authorization.
