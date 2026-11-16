# Proposal

## Why

Some Sub2API upstreams, including Antigravity accounts, answer HTTP 429 when Pi's default identity sentence is present in the request and answer HTTP 200 when only that sentence is replaced (issue #29). Users currently keep a separate extension that rewrites `payload.instructions` in `before_provider_request`. That workaround belongs in this provider, next to the other request adaptations, and must stay opt-in.

## What Changes

- Each relay entry may declare `promptReplacements`: model patterns plus a literal `from`/`to` pair.
- On `before_provider_request`, matching rules replace that text in the request's `instructions` string, in declaration order.
- A rule whose pattern does not match, or whose `from` is absent, leaves the request unchanged and does not raise.
- Omitting `promptReplacements` keeps today's requests. No other field of the payload changes.

## Capabilities

### New Capabilities

- `prompt-replacements`: model-scoped literal replacements applied to a relay request's `instructions` string.

### Modified Capabilities

None.

## Impact

`pi-provider-sub2api` config parsing, `RelayConfig`, one `before_provider_request` handler, the README, package tests, and a Pi scenario that records the Codex request body. `@indexyz/pi-provider-sub2api` gets a `minor` release intent: the setting is new, backwards-compatible functionality. Native Codex compaction builds its own request and is outside this hook.
