# Tasks

## 1. Type untyped string enums

- [x] 1.1 Add `withStringEnumTypes()`, a structured walk over schema keywords that does not mutate its input.
- [x] 1.2 Apply it to relay requests in `before_provider_request`, for the `parameters`, `function.parameters`, and `input_schema` shapes.
- [x] 1.3 Ship `tool-schema.ts` through `files`.

## 2. Prove it through the host

- [x] 2.1 Add a scenario covering all four APIs and a non-relay provider, seen failing before the handler and with its relay check removed.
- [x] 2.2 Add package tests for the walk: nested schemas, enums left alone, names and values that look like keywords.
- [x] 2.3 Observe that a native compaction request carries no `tools`, so it needs no handling.

## 3. Ship

- [x] 3.1 Document the behaviour in `README.md`.
- [x] 3.2 Record a `patch` intent for `@indexyz/pi-provider-sub2api`.
