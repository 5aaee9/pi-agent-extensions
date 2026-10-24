# @indexyz/pi-autocompact

Set an earlier automatic compaction threshold for the current model. The
threshold is session-only unless you pass `--save`, which stores it as the
user-level default for that model. Requires **Pi 0.87.1 or newer** (actionable
session boundaries).

## Install

```bash
pi install npm:@indexyz/pi-autocompact
```

Releases are published to npm as `@indexyz/pi-autocompact`; each release is tagged `@indexyz/pi-autocompact@<version>`.

To try a repository checkout (after `npm install` at the repository root):

```bash
pi -e ./pi-autocompact/index.ts
```

## Usage

```text
/autocompact 300k         # 300,000 tokens, current session/model only
/autocompact 0.3m         # same threshold; k/m are decimal units
/autocompact 300000
/autocompact 300k --save  # also store it as this model's user-level default
/autocompact --save 300k  # same as the line above
/autocompact              # show current threshold and native enabled state
/autocompact off          # use Pi defaults, ignoring plugin defaults in this session
/autocompact default      # clear the session override and inherit the global default
```

Without `--save`, commands never write settings. They also never append
threshold entries to the session, reload extensions, or modify the model's real
context-window metadata. `--save` is an error with `off`, `default`, a bare
status query, or any extra argument; those forms leave the session and the file
unchanged. Overrides are keyed by exact `provider/modelId`. Switching models
preserves each model's session override. New, resumed, and forked sessions,
restart, and `/reload` clear session overrides.

`off` does not disable Pi's own automatic compaction or overflow recovery.

## Saved and manual defaults

`--save` merges the parsed token count into your **user** `settings.json`
(normally `~/.pi/agent/settings.json`, respecting `PI_CODING_AGENT_DIR`) at
`piAutocompact.modelLimits["provider/modelId"]`. Other settings, including other
model limits and native compaction settings, stay in place. Project
`.pi/settings.json` is not written. You can still edit the same object by hand:

```json
{
  "piAutocompact": {
    "modelLimits": {
      "provider/model-id": 300000
    }
  }
}
```

Values are positive integer token counts. The command that saved also applies
the threshold to the current session, so that session does not need `/reload`.
Each session start reads user settings again, so a later new, resumed, or
forked session for that model uses the saved default with no further command.
A hand edit made while a session is already running is picked up at the next
session start; `/reload` is one way to start that fresh session. Plugin
defaults are read only from user settings; trusted project settings still
participate in native compaction configuration. A session command without
`--save` overrides the saved value without changing the file.

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
  before setting a threshold. Plugin defaults load from user settings at each
  session start (including after `/reload`); native compaction settings are
  re-read when configuring or checking a threshold.
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
