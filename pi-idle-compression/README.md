# @indexyz/pi-idle-compression

Compact a session's context automatically once it has sat idle. When Pi has
finished (no retry, compaction, or queued follow-up left) and no new input
arrives for the configured time — 50 minutes by default — the extension runs
Pi's native compaction once. A provider's prompt cache has usually expired by
the time you return, so the next prompt re-reads a summary instead of the whole
transcript.

## Install

```bash
pi install npm:@indexyz/pi-idle-compression
```

Releases are published to npm as `@indexyz/pi-idle-compression`; each release is tagged `@indexyz/pi-idle-compression@<version>`.

To try a repository checkout for one session (after `npm install` at the repository root):

```bash
pi -e ./pi-idle-compression/index.ts
```

## Usage

Nothing to do: install it and leave a session idle. You are notified when idle
compaction starts, completes, or fails.

```text
/idle-compression   # show the current model's idle time and the time left
```

The command only reports; it never writes settings or starts compaction, and
running it does not count as input.

## Settings

Configure it in your **user** `settings.json` (normally
`~/.pi/agent/settings.json`, respecting `PI_CODING_AGENT_DIR`) under
`piIdleCompression`. Every field is optional:

```json
{
  "piIdleCompression": {
    "enabled": true,
    "idleMinutes": 50,
    "providers": {
      "anthropic": { "idleMinutes": 4 },
      "ollama": { "enabled": false }
    },
    "models": {
      "openai/gpt-5": { "idleMinutes": 60 },
      "anthropic/claude-haiku-4-5": { "enabled": false }
    }
  }
}
```

| Field         | Type    | Default | Meaning                                                             |
| ------------- | ------- | ------- | ------------------------------------------------------------------- |
| `enabled`     | boolean | `true`  | Whether idle compaction runs                                        |
| `idleMinutes` | number  | `50`    | Minutes without input before compacting; fractions allowed, ≤ 35791 |

Each field is resolved separately: `models["provider/modelId"]`, then
`providers["provider"]`, then the top level, then the default. The model in
use when the idle period is armed decides; switching models while idle re-arms
with the new model's time, counted from the original idle start.

Settings are read whenever an idle period is armed, so edits apply from the
next one without `/reload`. An invalid value is reported as an error and that
idle period is not armed. Project `.pi/settings.json` is not read.

## Behavior

- An idle period starts when Pi settles after a run, and when a session opens
  with an existing conversation (resume, `/reload`); for a reopened session the
  clock starts when it is opened.
- User input, a new agent run, or the start of any native compaction (for example
  `/compact`) ends the idle period, including a compaction that later fails or is
  cancelled. The next one starts when Pi settles again.
- Compaction happens at most once per idle period. It is skipped when Pi is not
  idle, messages are queued, the conversation is already compacted, or Pi has
  not measured the context since the last compaction.
- It uses Pi's native compaction (the same as `/compact`), including other
  extensions' `session_before_compact` hooks and native
  `compaction.keepRecentTokens`. It calls the model and consumes tokens. A
  session too small to compact is reported as a failed compaction.
- A prompt typed while idle compaction runs waits for it, as after `/compact`.
- The timer never keeps Pi running: print and RPC modes exit normally.

Pi 1.5.0 defaults to `cacheWarming: "streaming"`, which warms eligible prompt
caches during active runs. If you select `cacheWarming: "idle"`, Pi can also pay
to keep a cache warm between runs. This extension still compacts at its configured
idle deadline; it does not inspect cache warmth or change Pi's warming policy.
Compacting replaces the cached transcript with a summary, so a deliberately warm
cache may lose its benefit. To keep that cache, disable idle compression for the
relevant provider or model, or choose a longer idle interval.

## Development

```bash
npm install
npm run check --workspace @indexyz/pi-idle-compression
```

## License

MIT
