# Tasks

## 1. Change

- [x] 1.1 Remove the wrapper; verify the native round trip scenario passes for all 12 API and key combinations.
- [x] 1.2 Confirm that scenario depends on `authHeader`: dropping it fails on `anthropic-messages-header`.
- [x] 1.3 Add scenario "a command-sourced key reaches Ollama as a bearer token when authHeader asks for it"; verify it fails with no bearer path at all. Dropping `authHeader` alone does not fail it, because the Ollama client also adds the bearer itself.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-custom-provider`.
