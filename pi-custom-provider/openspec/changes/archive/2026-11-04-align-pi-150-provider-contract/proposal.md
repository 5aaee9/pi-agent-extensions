# Proposal

## Why

Pi 1.5.0 passes normalized transcripts to providers. The Ollama adapter still reads legacy top-level tools, silently omitting every tool declaration, and its copied host types no longer typecheck.

## What Changes

- **BREAKING**: require Pi 1.5.0 and remove the old system-message compatibility types.
- Resolve the active prompt and tools from transcript system messages for Ollama requests.
- Await raw provider stream observers before normalizing each NDJSON event.
- Align model, tool argument, and request-option types with the host and use its public transcript helpers.
- Verify tools, prompt updates, tool results, and observation through the real Pi host and a local HTTP endpoint.

## Capabilities

### New Capabilities

- `ollama-transcripts`: Ollama request conversion and observation of normalized Pi transcripts.

### Modified Capabilities

None.

## Impact

Changes are confined to the custom provider package and its release intent. Other supported protocols retain their native Pi adapters. Shared dependency pinning and lockfile changes are coordinated at repository scope.
