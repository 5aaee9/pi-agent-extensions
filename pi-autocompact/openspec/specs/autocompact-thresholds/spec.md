# autocompact-thresholds Specification

## Purpose

Set a per-model automatic compaction threshold for the current session, and optionally save that threshold as the user-level default for the same model.

## Requirements

### Requirement: Session threshold stays in memory

`/autocompact` with a positive threshold and no `--save` SHALL set that threshold for the current model in the current session only. It SHALL NOT create or modify settings. `off` SHALL suppress a saved default for this model until the session ends. `default` SHALL clear the session override. A bare `/autocompact` SHALL report the effective threshold and SHALL NOT write settings.

#### Scenario: Numeric threshold without save

- **WHEN** the user runs `/autocompact 300k` for provider `provider` and model `model`
- **THEN** the session compacts that model above 300000 tokens
- **AND** user settings are not created or modified

#### Scenario: Off and default stay session-local

- **WHEN** the user runs `/autocompact off` and later `/autocompact default`
- **THEN** `off` ignores a saved default until `default` restores it
- **AND** neither command writes settings

### Requirement: Save persists the current model

`/autocompact <threshold> --save` SHALL apply the same session override as a threshold without `--save` and SHALL store the parsed positive integer under user settings `piAutocompact.modelLimits`, keyed by `provider/modelId`. `--save` MAY appear before or after the threshold. The command SHALL update an existing key for that model and SHALL leave every other settings value unchanged, including other model limits and native compaction settings.

#### Scenario: Save a new default

- **WHEN** the user runs `/autocompact 300k --save` or `/autocompact --save 0.3m` for `provider/model`
- **THEN** the current session uses 300000 tokens for that model
- **AND** user settings contain `piAutocompact.modelLimits["provider/model"]` equal to 300000

#### Scenario: Merge into existing settings

- **WHEN** user settings already contain other top-level keys and another `modelLimits` entry
- **THEN** saving updates only the current model's limit
- **AND** the other keys and the other model limit remain

### Requirement: Save is rejected without a threshold

`--save` SHALL be an error with `off`, `default`, a bare status query, a repeated `--save`, an unknown option, or any extra argument. The error SHALL name the problem. The session override and the settings file SHALL stay unchanged.

#### Scenario: Off with save

- **WHEN** the user runs `/autocompact off --save` or `/autocompact --save default`
- **THEN** the command reports that `--save` requires a threshold
- **AND** the session override and settings file are unchanged

#### Scenario: Save alone

- **WHEN** the user runs `/autocompact --save`
- **THEN** the command reports that a threshold is required
- **AND** no settings file is created

### Requirement: Later sessions inherit the saved default

A session start SHALL load `piAutocompact.modelLimits` from user settings the same way a hand-edited default is loaded. After a successful save, a new, resumed, or forked session for that model SHALL use the saved threshold without another command. The session that saved SHALL keep the threshold without `/reload`. `/reload` remains the way a running session picks up a settings edit made outside the command, because defaults are read at session start.

#### Scenario: Next session uses the saved limit

- **WHEN** the user saved 300000 for `provider/model` and a later session starts with that model
- **THEN** the model compacts above 300000 tokens without another `/autocompact` command

#### Scenario: Saving session does not need reload

- **WHEN** the user runs `/autocompact 300k --save` in the current session
- **THEN** that session compacts above 300000 tokens immediately
- **AND** `/autocompact default` in that same session still inherits the saved 300000

### Requirement: Failed save changes nothing

A save SHALL read the latest user settings and replace the file only with a complete merged document. A failure SHALL report an error and SHALL NOT change the session override or the existing file bytes. A missing settings file SHALL be created only when the save succeeds.

#### Scenario: Malformed settings

- **WHEN** user settings exist but are not valid JSON and the user runs `/autocompact 300k --save`
- **THEN** the command reports the parse error
- **AND** the file bytes and the session override are unchanged

#### Scenario: Invalid settings shape

- **WHEN** `piAutocompact` or `modelLimits` is not an object
- **THEN** the command reports that error
- **AND** the file bytes and the session override are unchanged

### Requirement: Rejected thresholds are not stored

The command SHALL validate a threshold against `keepRecentTokens` and the model context window, and SHALL require native automatic compaction to be enabled, before it writes or changes the session override. A rejected threshold SHALL leave both unchanged.

#### Scenario: Invalid threshold is not stored

- **WHEN** the threshold is not above `keepRecentTokens`, is not below the model context window, or native automatic compaction is disabled
- **THEN** the command reports the validation error
- **AND** settings are not written and the previous session override remains

### Requirement: User settings file only

A save SHALL write the user settings file resolved from `PI_CODING_AGENT_DIR` when that variable is set, and `~/.pi/agent/settings.json` otherwise. It SHALL NOT write project settings.

#### Scenario: Project settings stay untouched

- **WHEN** the user runs `/autocompact 300k --save` in a trusted project that has its own settings file
- **THEN** the user settings file receives the model limit
- **AND** the project settings file is unchanged
