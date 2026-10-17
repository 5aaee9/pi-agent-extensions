# Proposal

## Why

Generated dsh host and browser artifacts currently pollute Git history even though each package already builds them during `prepack`. Removing them from version control must preserve local installs, packed releases, and release decisions for source changes that no longer produce tracked output diffs.

## What Changes

- Pin OpenSpec as repository development tooling, available through `npx openspec` after `npm ci`.
- Ignore root-level `dsh-*/lib/` and `dsh-*/client.js`, and remove their existing entries from the Git index while preserving local files.
- Keep npm `files` allowlists and `prepack` builds; document building before a local `link:` installation.
- Treat dsh runtime TypeScript sources and build configuration as release-impacting inputs, with regression coverage.
- Update repository policy and package installation guidance. Earlier in-flight plans that require committed output are superseded by this change's build policy.

## Capabilities

### New Capabilities

- `dsh-packages`: generated output belongs in local builds and npm tarballs, while Git contains source and build configuration. This capability exists only in the older in-flight `support-dsh-packages` proposal, not in current main specs.

### Modified Capabilities

- `package-releases`: require decisions for dsh build inputs even when those inputs are absent from the tarball allowlist.

## Impact

This is repository-wide build and release policy affecting `@indexyz/dsh-autocompact`, `@indexyz/dsh-custom-provider-reasoning-efforts`, and `@indexyz/dsh-thread-summary`; runtime behavior and package versions do not change. Each gets a `none` release intent explaining unchanged runtime output and development documentation changes. Root tooling, lockfile, ignore rules, release gate, policy docs, and package READMEs change. No publication or push is included.
