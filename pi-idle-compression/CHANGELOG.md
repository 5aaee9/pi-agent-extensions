# Changelog

## 0.1.1

### Patch Changes

- Cancel idle compaction timers when native compaction starts, including failed or cancelled attempts, and document interaction with idle cache warming. Verify against Pi 1.5.0.

## 0.1.0

### Minor Changes

- First release: compact a session's context automatically after it has been idle (no new input) for a configurable time, 50 minutes by default, set globally, per provider, or per model in `settings.json` under `piIdleCompression`. `/idle-compression` shows the effective idle time and the time left.
