---
"@indexyz/dsh-thread-summary": none
---

Verification only: the host half's title provider is now checked through the real LLM stack — the real `LlmRuntime` and the real `@deepseek-ai/dsh-llm-pi-ai` adapter streaming from a locally started OpenAI-compatible endpoint — and the client half by booting the real Harness web plane in a browser, with the host's own dormant `llm-pi-ai` adapter supplying the model catalog from that local endpoint (no third-party plugin, no network). The installed-package check loads the packed tarball into that same web plane and saves a catalog route through the host's settings service. Only test files, the README's verification paragraph and development dependencies changed (`@deepseek-ai/dsh`, `@deepseek-ai/dsh-llm-pi-ai` and `playwright`, pinned exactly); published runtime code is unchanged.
