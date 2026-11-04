# @indexyz/pi-autocompact

Set an earlier automatic compaction threshold for the current model, and cap
thresholds per provider or globally. A threshold is session-only unless you pass
`--save`, which stores it as the user-level default for that model;
`--save-provider` and `--save-global` store caps. Requires **Pi 0.87.1 or newer** (actionable
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
/autocompact 80%          # 80% of the current model's context window
/autocompact 300k --save  # also store it as this model's user-level default
/autocompact --save 300k  # same as the line above
/autocompact 80% --save-provider  # store a cap for every model of this provider
/autocompact 300k --save-global   # store a cap for every model
/autocompact              # show the effective threshold, its source, and native state
/autocompact off          # use Pi defaults, ignoring plugin defaults and caps in this session
/autocompact default      # clear the session override and inherit the global default
```

Without a save flag, commands never write settings. They also never append
threshold entries to the session, reload extensions, or modify the model's real
context-window metadata. A save flag is an error with `off`, `default`, a bare
status query, another save flag, or any extra argument; those forms leave the
session and the file unchanged. Overrides are keyed by exact `provider/modelId`. Switching models
preserves each model's session override. New, resumed, and forked sessions,
restart, and `/reload` clear session overrides.

`off` does not disable Pi's own automatic compaction or overflow recovery.

## Thresholds and caps

The effective threshold for a model is the **lowest** of:

1. its threshold: the session value from `/autocompact <value>`, otherwise its
   saved model limit;
2. its provider cap;
3. the global cap;
4. the model's context window.

Levels that are not set are skipped; with none set, the plugin does nothing for
that model. A model threshold can lower a cap but never raise it, so
`/autocompact 500k` under a 300k provider cap compacts above 300k, and the
status message names the cap. Every value is either a token count or a
percentage of the current model's context window (rounded down), so one cap fits
models with different windows.

When the effective threshold is not above `keepRecentTokens`, or not below the
context window, the plugin leaves that model to Pi's native compaction without a
warning; `/autocompact` shows the reason. A session or model threshold must be
usable for the current model when you set it; a provider or global cap may be
unusable for some models.

## Saved and manual defaults

`--save`, `--save-provider`, and `--save-global` merge the value into your
**user** `settings.json` (normally `~/.pi/agent/settings.json`, respecting
`PI_CODING_AGENT_DIR`) at `piAutocompact.modelLimits["provider/modelId"]`,
`piAutocompact.providerLimits["provider"]`, or `piAutocompact.globalLimit`.
Other settings, including other limits and native compaction settings, stay in
place. Project `.pi/settings.json` is not written. You can still edit the same
object by hand:

```json
{
  "piAutocompact": {
    "modelLimits": {
      "provider/model-id": 300000
    },
    "providerLimits": {
      "provider": "80%"
    },
    "globalLimit": 400000
  }
}
```

Values are positive integer token counts or percentage strings greater than
`"0%"` and at most `"100%"`. Version 0.2.x reads only integer `modelLimits`
and reports a percentage string there as an error at session start. The command that saved also applies
the value to the current session, so that session does not need `/reload`.
Saving a cap leaves the session's own threshold in place.
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
  Entries proposed by earlier extensions at the same boundary are preserved in
  order before the new compaction entry.
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
