# Spec Delta

## Purpose

为仓库中的 Pi 与 DSH 插件提供统一的宿主加载验证能力，使插件入口、注册协议、构建产物和隔离安装结果在 CI 中都能被实际执行确认。该能力不依赖模型调用或外部业务服务，并为每个失败包保留可操作的诊断信息。

## ADDED Requirements

### Requirement: Every workspace plugin is discovered and exercised

CI SHALL discover every workspace package that declares a supported Pi or DSH manifest and SHALL execute that package's host loading check in the same run.

#### Scenario: A new manifest package is added

- **WHEN** a workspace package declares a Pi or DSH manifest and is included in the npm workspaces
- **THEN** the E2E run includes it without requiring a separate hard-coded package list

#### Scenario: An unsupported workspace package exists

- **WHEN** a workspace package has neither a supported Pi nor DSH manifest
- **THEN** the E2E run skips it and does not fail the whole run

### Requirement: Pi packages load through the Pi host

Each Pi package SHALL be loaded with its package-local Pi binary in non-interactive RPC mode, offline, with isolated session and agent directories, and SHALL succeed only when the process exits 0 and returns a successful `get_commands` response.

#### Scenario: A Pi extension registers commands

- **WHEN** the runner loads a Pi package whose extensions register commands
- **THEN** the RPC response reports `get_commands` as successful and the package passes

#### Scenario: A Pi extension entry fails to register

- **WHEN** an extension entry throws while the Pi host loads it
- **THEN** the run reports that package as failed with the host's load diagnostics

### Requirement: DSH packages load from their packed artifacts

Each DSH package SHALL be built, packed, installed into an isolated temporary prefix without peer re-resolution, and checked with the `release.smoke` script its manifest declares against the installed copy.

#### Scenario: A dsh plugin activates after a host bump

- **WHEN** the workspace pins a new dsh host line and the plugin still mounts its services
- **THEN** the packed and installed plugin passes its declared smoke check in the run

#### Scenario: A dsh smoke script is missing

- **WHEN** a DSH package does not declare a relative `.ts` `release.smoke` script
- **THEN** the run fails that package with an actionable manifest error instead of guessing an entry point

### Requirement: Loading runs stay offline and bounded

The E2E run SHALL make no model or business API calls, SHALL bound each package command with a timeout, and SHALL clean every temporary artifact it creates.

#### Scenario: A package command hangs

- **WHEN** a host or packaging command exceeds its timeout
- **THEN** the run reports the package as failed with the timed-out command and removes its temporary directory

### Requirement: Failures are aggregated and diagnosable

The run SHALL continue after an individual package failure, SHALL report per-package result with command, exit status, duration, and truncated output, and SHALL exit non-zero after printing the total, passed, and failed summary.

#### Scenario: One plugin fails among many

- **WHEN** one package fails and the rest pass
- **THEN** the run still executes every remaining package and lists the failed package in its failure report

### Requirement: The check is available in CI and by hand

The repository SHALL expose the run as the root `test:e2e` script, SHALL run it in the CI quality workflow after the repository check, and SHALL document its command, offline guarantees, discovery rules, and failure diagnostics in repository workflow documentation.

#### Scenario: CI runs the host loading gate

- **WHEN** a push or pull request reaches the quality workflow
- **THEN** `npm run test:e2e` runs after `npm run check` and a failing plugin fails the workflow
