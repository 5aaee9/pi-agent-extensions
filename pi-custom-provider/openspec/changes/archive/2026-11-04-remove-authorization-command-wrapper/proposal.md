# Proposal

## Why

For a `!command` key with `authHeader: "authorization"`, `providerConfig` wrapped the command in a `!printf 'Bearer %s'` header, because Pi once put the literal command in `Authorization`. Pi 1.5.0 resolves the key before applying `authHeader` (`provider-composer.js`, `withConfiguredAuth`), so the wrapper is obsolete, and it runs the command a second time for every request.

## What Changes

- A `!command` key uses Pi's `authHeader`, like any other key.

## Capabilities

### New Capabilities

- `native-auth`: how a configured key reaches a provider as a bearer token.

### Modified Capabilities

None.

## Impact

`pi-custom-provider/discovery.ts`. `@indexyz/pi-custom-provider` gets a `patch` release intent. Pi 1.5.0 is already this package's documented minimum.
