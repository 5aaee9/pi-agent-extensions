# Proposal

## Why

GPT-6.2 bills Responses `instructions` as uncached input appended after `input`. Sub2API v0.2.24 still fills a blank `instructions` field with a multi-thousand-token Codex default on ordinary Codex OAuth, including when Pi already sent a leading developer message. That default then misses the prompt cache on every turn. The gateway change that would move it into `input` is not merged.

## What Changes

Add an opt-in, per-provider `cacheCodexInstructions` setting. When it is on, covered GPT-6.2 Sol and Astra Codex Responses requests, including native compaction, place the pinned v0.2.24 default in the leading developer message and set a short non-blank top-level `instructions` value. Explicit non-blank instructions stay as sent. The setting defaults off, and turning it off restores the previous request.

## Capabilities

### New Capabilities

- `codex-instruction-cache`: Keep the pinned GPT-6.2 Codex default in the cacheable developer prefix while an unfixed gateway would otherwise inject it as top-level instructions.

### Modified Capabilities

## Impact

`pi-provider-sub2api` configuration, the Codex request hook, native compaction, and the published data files that hold the pinned prompts. No gateway, account, or live model call changes.
