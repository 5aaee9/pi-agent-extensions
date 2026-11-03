# Spec Delta

## Purpose

为 pi-ask 提供稳定、可迁移且不依赖独立配置文件格式的用户级行为配置，包括 keymap、通知、回答提取和交互偏好。

## ADDED Requirements

### Requirement: Persist pi-ask configuration in pi-ask.json

The extension SHALL read and persist its user configuration in `pi-ask.json` under Pi's agent directory (respecting `PI_CODING_AGENT_DIR`), leaving unrelated settings files and unknown configuration keys untouched.

#### Scenario: Load configured behavior

- **WHEN** `pi-ask.json` contains valid behavior, keymap, notification, or extraction settings
- **THEN** the ask flow uses those settings for the current session

#### Scenario: Missing configuration

- **WHEN** `pi-ask.json` does not exist
- **THEN** the extension uses documented defaults and may create a default configuration snapshot at that path

### Requirement: Recover safely from invalid configuration

The extension SHALL keep an invalid `pi-ask.json` unchanged, use safe defaults for invalid portions, and report a user-visible notice explaining how to fix it.

#### Scenario: Malformed configuration

- **WHEN** the configuration file is malformed or contains invalid values
- **THEN** the extension does not overwrite it, loads safe defaults for the affected settings, and shows a manual-edit notice

### Requirement: Apply settings during an active flow

The extension SHALL apply supported persisted setting changes to an active ask flow without requiring the flow to restart, while applying presentation-mode changes only to newly created or replayed flows.

#### Scenario: Change a setting while asking

- **WHEN** the user changes a supported setting through the ask settings surface and the save succeeds
- **THEN** the active flow updates its applicable behavior and keymap immediately
