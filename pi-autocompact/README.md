# @indexyz/pi-autocompact

Set an earlier automatic compaction threshold for the current model, **in memory
for the current session only**. Requires **Pi 0.87.1 or newer** (actionable session
boundaries).

```bash
pi install npm:@indexyz/pi-autocompact
```

```text
/autocompact 300k    # 300,000 tokens, current session/model only
/autocompact 0.3m    # same threshold; k/m are decimal units
/autocompact 300000
/autocompact         # show current threshold and native enabled state
/autocompact off     # use Pi defaults, ignoring plugin defaults in this session
/autocompact default # clear the session override and inherit the global default
```

Commands never write settings, append threshold entries to the session, reload
extensions, or modify the model's real context-window metadata. Overrides are
keyed by exact `provider/modelId`. Switching models preserves each model's
session override; new/resumed/forked sessions, restart and `/reload` reset them.
`off` does not disable Pi's own automatic compaction or overflow recovery.

## Optional global defaults

To persist defaults, manually add this to your **user** `settings.json` (normally
`~/.pi/agent/settings.json`, respecting `PI_CODING_AGENT_DIR`) and run `/reload`:

```json
{
  "piAutocompact": {
    "modelLimits": {
      "provider/model-id": 300000
    }
  }
}
```

Values are positive integer token counts. Session commands override these values
without changing the file. Plugin defaults are read only from user settings;
trusted project settings still participate in native compaction configuration.

## Behavior and limitations

- Above the threshold, summarize at safe `turn_end` / `agent_before_settle`
  boundaries, after tools finish. Use Pi's standard summary generator and return
  a compaction entry through its boundary API; do not abort the agent or inject a
  synthetic user prompt. Normal tool/follow-up scheduling continues unchanged.
- Idle input also checks the threshold before submitting a prompt, using native
  `ctx.compact()` with its usual extension hooks.
- Boundary compaction preserves recent context according to the effective native
  `keepRecentTokens`, including complete assistant/tool-result groups. It uses
  the projected context so prior compactions and context edits are respected.
  The threshold must exceed `keepRecentTokens` and be below the real model window.
- Boundary summaries use the active registered provider and standard Pi summary
  generator; they do **not** invoke `session_before_compact` custom/native relay
  hooks. Pi's own auto/overflow/manual compaction remains untouched.
- Native `compaction.enabled: false` is respected. Enable it via `/settings`
  before setting a threshold. Plugin defaults load at startup/reload; native
  compaction settings are re-read when configuring or checking a threshold.
- Thresholds are not strict request-size caps: one turn/tool batch can overshoot.
  Unknown usage is skipped. If an indivisible or too-small context cannot retain
  recent content and shrink, the plugin leaves it to native/manual compaction.
- Summary generation consumes model tokens. Failures leave context intact and
  are not retried at the same session boundary. A subsequent turn can try again.

## Development

```bash
npm run check
pi -e ./pi-autocompact/index.ts
```
