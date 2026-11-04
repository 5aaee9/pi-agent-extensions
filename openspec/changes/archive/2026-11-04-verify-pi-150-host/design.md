# Design

## Context

The smoke runner currently chooses a binary by filesystem presence. Missing package-local dependencies can silently select an older root copy. See proposal.md for the audit context.

## Goals / Non-Goals

Verify host identity as well as successful loading; keep packages independently pinned and DSH behavior unchanged. This change does not implement package runtime fixes.

## Decisions

Resolve pi-coding-agent from each package manifest using Node module resolution, read that resolved package version and bin, and reject a mismatch with an npm install hint. Do not invoke whichever PATH or .bin entry happens to exist. The existing CI already runs this runner.

Coordinate 1.5.0 host development pins in all Pi packages and refresh npm's lockfile, preserving exact DSH pins. Update the reference and workflow examples to the installed layout. Record none intents for pin-only packages; package-specific behavior changes carry patch intents.

## Risks / Trade-offs

A stale installation now fails early rather than producing misleading compatibility evidence. The installation must be refreshed before checks.
