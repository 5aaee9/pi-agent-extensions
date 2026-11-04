# Design

## Context

See proposal.md for motivation. Ollama owns a custom wire adapter while other configured APIs delegate to Pi. Pi 1.5.0 provides public transcript helpers but still keeps its generic message transformation and token-clamping helpers outside the extension import surface.

## Goals / Non-Goals

**Goals:** Make Ollama honor the normalized transcript and instrumentation contracts; remove obsolete compatibility types and compile against the current host.

**Non-Goals:** Replace native Ollama streaming with Chat Completions, change authentication or discovery behavior, or add private-module runtime imports.

## Decisions

- Use the host's `TranscriptContext`, `SystemMessage`, `getSystemMessageText`, `getCurrentTools`, and `collapseSystemMessages`. Collapse sections into a single system message because Ollama does not implement Pi's section-patching protocol.
- Keep only the helpers that the extension loader cannot import publicly. Update their types and request options to Pi 1.5.0, preserving telemetry and identity through an option spread rather than a stale allowlist.
- Narrow discovered models to the chat variant of `ProviderModelConfig` and parse tool arguments as JSON objects. The extension registers chat models only.
- Make NDJSON consumption await each observer before event assembly. Exercise the adapter through Pi's real extension loader and model registry against a real local HTTP server; use no fake host or stream.

## Risks / Trade-offs

- Copied transformation helpers can drift on future upgrades → keep their purpose explicit and verify against pinned host changes.
- A failing observer now fails the stream → this matches the documented instrumentation contract and gets a regression check.

## Migration Plan

The coordinated repository update raises the package host pins to 1.5.0. Users upgrade Pi before installing this release; no configuration or persistent-data migration is needed.
