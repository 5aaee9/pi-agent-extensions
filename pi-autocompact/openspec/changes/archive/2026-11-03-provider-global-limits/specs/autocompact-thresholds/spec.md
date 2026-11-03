# Spec Delta

## MODIFIED Requirements

### Requirement: Session threshold stays in memory

`/autocompact` with a positive threshold and no save flag SHALL set that threshold for the current model in the current session only. It SHALL NOT create or modify settings. `off` SHALL suppress the saved model default and the provider and global caps for this model until the session ends. `default` SHALL clear the session override. A bare `/autocompact` SHALL report the effective threshold and SHALL NOT write settings.

#### Scenario: Numeric threshold without save

- **WHEN** the user runs `/autocompact 300k` for provider `provider` and model `model`
- **THEN** the session compacts that model above 300000 tokens
- **AND** user settings are not created or modified

#### Scenario: Off and default stay session-local

- **WHEN** the user runs `/autocompact off` and later `/autocompact default`
- **THEN** `off` ignores a saved default until `default` restores it
- **AND** neither command writes settings

#### Scenario: Off ignores caps

- **WHEN** user settings define a provider cap and a global cap and the user runs `/autocompact off`
- **THEN** the plugin does not compact the current model in this session
- **AND** `/autocompact default` restores both caps

### Requirement: Save is rejected without a threshold

`--save`, `--save-provider`, and `--save-global` SHALL each be an error with `off`, `default`, a bare status query, a repeated flag, more than one of these flags together, an unknown option, or any extra argument. The error SHALL name the problem. The session override and the settings file SHALL stay unchanged.

#### Scenario: Off with save

- **WHEN** the user runs `/autocompact off --save` or `/autocompact --save-global default`
- **THEN** the command reports that the save flag requires a threshold
- **AND** the session override and settings file are unchanged

#### Scenario: Save alone

- **WHEN** the user runs `/autocompact --save` or `/autocompact --save-provider`
- **THEN** the command reports that a threshold is required
- **AND** no settings file is created

#### Scenario: Two save flags

- **WHEN** the user runs `/autocompact 300k --save --save-global`
- **THEN** the command reports that only one save flag may be given
- **AND** the session override and settings file are unchanged

## ADDED Requirements

### Requirement: Limits accept tokens or a context-window percentage

Every threshold and cap, on the command line and in settings, SHALL be either a positive integer token count or a percentage greater than 0 and at most 100 of the current model's context window. The command SHALL accept `k`/`m` suffixes and `<number>%`; settings SHALL store a positive integer or a string `"<number>%"`. A percentage SHALL resolve to the floor of that fraction of the model's context window.

#### Scenario: Percentage threshold

- **WHEN** the current model's context window is 200000 and the user runs `/autocompact 80%`
- **THEN** the session compacts that model above 160000 tokens

#### Scenario: Invalid percentage

- **WHEN** the user runs `/autocompact 0%` or `/autocompact 150%`, or settings contain `"globalLimit": "abc"`
- **THEN** the command or session start reports an invalid-limit error
- **AND** the command changes neither the session override nor the settings file

### Requirement: Provider and global caps

User settings MAY define `piAutocompact.providerLimits["<provider>"]` and `piAutocompact.globalLimit`. For the current model, the effective threshold SHALL be the minimum of the defined values among its threshold (the session override, otherwise its saved model limit), its provider cap, the global cap, and its context window. With no threshold and no cap defined, or after `off`, the plugin SHALL NOT compact that model.

#### Scenario: Global cap alone

- **WHEN** only `globalLimit` is `"80%"` and the model's context window is 200000
- **THEN** the plugin compacts that model above 160000 tokens

#### Scenario: Lowest level wins

- **WHEN** `globalLimit` is 300000, `providerLimits["provider"]` is 200000, and `modelLimits["provider/model"]` is 250000
- **THEN** `provider/model` compacts above 200000 tokens

#### Scenario: Session threshold is capped

- **WHEN** `providerLimits["provider"]` is 200000 and the user runs `/autocompact 300k` for `provider/model`
- **THEN** the session compacts that model above 200000 tokens
- **AND** the command reports that the provider cap limits the threshold

#### Scenario: Cap above the window

- **WHEN** `globalLimit` is 1000000 and the model's context window is 200000, with no other limit
- **THEN** the plugin does not compact that model and leaves it to native compaction

### Requirement: Unusable effective thresholds are skipped

When the effective threshold is at or above the model's context window, or at or below the effective native `keepRecentTokens`, automatic plugin compaction SHALL NOT run for that model and SHALL NOT report a warning at each boundary. A bare `/autocompact` SHALL report the effective threshold, the level that set it, and why it is unusable.

#### Scenario: Cap below keepRecentTokens

- **WHEN** `globalLimit` is `"5%"`, the model's context window is 128000, and `keepRecentTokens` is 20000
- **THEN** the plugin does not compact that model
- **AND** a bare `/autocompact` reports that 6400 tokens does not exceed `keepRecentTokens`

### Requirement: Save provider and global caps

`/autocompact <value> --save-provider` SHALL store the value under user settings `piAutocompact.providerLimits` keyed by the current model's provider, and `--save-global` SHALL store it as `piAutocompact.globalLimit`. Either SHALL require native automatic compaction to be enabled, SHALL leave every other settings value and the session override unchanged, and SHALL apply to the current session immediately. Failed saves SHALL follow the same no-change rules as `--save`.

#### Scenario: Save a provider cap

- **WHEN** the user runs `/autocompact 80% --save-provider` for `provider/model`
- **THEN** user settings contain `piAutocompact.providerLimits["provider"]` equal to `"80%"`
- **AND** every model of `provider` in this and later sessions uses that cap

#### Scenario: Save a global cap

- **WHEN** the user runs `/autocompact 300k --save-global`
- **THEN** user settings contain `piAutocompact.globalLimit` equal to 300000
- **AND** `modelLimits` and `providerLimits` entries remain
