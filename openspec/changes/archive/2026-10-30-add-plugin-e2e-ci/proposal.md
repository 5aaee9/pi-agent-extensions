# Proposal

## Why

当前 CI 能验证源码格式、类型、单元测试和发布包的静态 smoke，但不会在每次变更中用对应宿主实际加载所有 Pi 与 DSH 插件。插件因此可能在宿主 API、入口注册、构建产物或加载协议发生不兼容时才被发现；现在已有多个 DSH 包和独立的 Pi 包，值得把完整加载验证提升为 CI 的明确门禁。

## What Changes

- 增加仓库级 TypeScript E2E runner，自动发现工作区中的 Pi 和 DSH 包，并按各包声明的宿主与 manifest 执行加载检查。
- 对每个 Pi 包使用 Pi 的非交互 RPC 模式加载扩展，验证进程成功退出并返回成功响应；覆盖命令、 provider 或其他注册能力的可观察结果。
- 对每个 DSH 包先构建并打包，再在隔离安装目录中执行其 release smoke，并补充统一的 DSH 加载结果与诊断输出。
- 为 runner 提供确定性、无模型、无外部 API 的执行约束、超时、失败聚合和包级日志，便于 CI 定位单个插件故障。
- 在 CI 质量工作流中加入 E2E 阶段，并提供本地 npm script；不改变任何插件运行时 API或发布内容。

## Capabilities

### New Capabilities

- `plugin-e2e-loading`: 使用真实 Pi 和 DSH 宿主完整加载工作区插件，并以可诊断的包级结果判定加载契约是否满足。

### Modified Capabilities

- 无

## Impact

这是仓库级测试和 CI 改动，影响根 package scripts、scripts/ 下的测试 runner、GitHub Actions 工作流及根级测试文档；不会修改任何单个插件的发布文件，因此不需要为插件创建 release intent。runner 会读取各工作区 package.json、复用现有 Pi 二进制和 DSH `release.smoke` 约定，并使用临时目录承载打包/安装产物。
