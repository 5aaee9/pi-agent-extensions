# Proposal

## Why

Sub2API Grok groups require a dedicated API key. The extension needs an explicit xAI entry that discovers Grok models and their metadata, exposes their supported reasoning controls, and sends requests according to the Grok channel contract.

## What Changes

- **BREAKING:** Raise the package’s minimum supported Pi version to 1.4.0 and use exactly 1.4.0 for development and baseline acceptance. Earlier hosts are outside the support contract.
- Add `api: "xai"` to a named relay entry with its own endpoint and token. Use the configured name as the Pi provider identity and Pi’s `openai-responses` API for generation.
- Discover chat models through `/v1/models`. Resolve limits, modalities, prices, reasoning capability, and effort choices from remote metadata and exact-ID xAI catalogs, with documented defaults for missing fields.
- Support encrypted reasoning replay, ordinary local function tools, provider-local billing/quota, and Pi textual compaction. Define xAI request fields and command eligibility explicitly.
- Use Sub2API’s request-level opt-out for automatic native-search cache routing so local tools remain local. Hosted tools and the planned separate search plugin are outside this change.
- Document configuration, capability limits, and verification. Existing entry types retain their behavior.

## Capabilities

### New Capabilities

- xai-relay: Grok entry configuration, authentication, chat discovery, metadata, reasoning, Responses requests, and local-tool behavior.

### Modified Capabilities

- request-mode-persistence: Add the xAI entry eligibility contract; its stored request-mode preferences remain inactive and its mode commands reject changes.

## Impact

- Implementation stays within `pi-provider-sub2api/`: configuration, discovery, metadata, registration, request handling, command eligibility, and package tests. Update its README and the root package-table description when implementation ships.
- Upgrade this package’s three Pi host devDependencies to 1.4.0, refresh the npm lockfile, and update the package README plus its entry in `docs/pi-reference.md`. Host peerDependencies remain `"*"` under repository policy. No other workspace package is upgraded; no new SDK, server change, or search package is required.
- The unpublished `openspec/` directory needs no release intent; the published feature requires a release intent for `@indexyz/pi-provider-sub2api` covering both xAI support and the raised minimum host version. Implementation, commits, version preparation, and publication remain separate actions.
