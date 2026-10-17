# Proposal

## Why

新会话目前使用默认或手工标题，用户在会话列表中难以快速识别刚刚开始的任务。DeepSeek Harness 已提供 `sessionTitle` 的日志化 provider 扩展点和可配置的 LLM 流式调用能力，因此可以在首条用户输入后用用户选择的 summary 模型生成简短标题，并由 Harness 统一持久化和展示。

## What Changes

- 新增 `dsh-thread-summary/`，发布为 `@indexyz/dsh-thread-summary`。
- 在 `设置 → 通用设置` 注册一个 summary model 设置，允许分别选择 Provider 和 Model，并支持关闭自动摘要。
- 在每个新会话的首条合格用户输入到达后，用配置的 summary 模型请求一个简短标题；只取文本结果，去除包裹引号、换行和多余空白后交给 `sessionTitle` 接受。
- 仅在配置存在、会话没有用户手工标题且当前输入属于首条提示时生成；请求失败、取消或模型不可用时保留 Harness 的默认标题流程。
- 使用 `sessionTitle.register()` 返回的 provider 合同，生成结果携带实际使用的消息 seq 和模型身份；不新增自定义 session event。
- 提供 Host 半、Client 设置页、bundle manifest、构建产物、测试、README 和 release smoke 检查，并加入 workspace。
- 借鉴 Codex 的输入预算和 Unicode 安全标题处理：生产请求限制为 4 KiB，生成限制为 60 秒；显式刷新仍只总结首条输入，测试覆盖实际请求、取消与宿主标题持久化。

## Capabilities

### New Capabilities

- `thread-summary-settings`: 通用设置中的 summary 模型配置、启用开关、路由校验、读写和本地化。
- `thread-summary-generation`: 首条用户输入触发的异步摘要生成、输出清洗、取消和失败回退。
- `thread-summary-package`: dsh bundle/client manifest、构建、发布文件和验证要求。

### Modified Capabilities

None; this is a new package.

## Impact

- 新增 `dsh-thread-summary/` 包及其 OpenSpec 文件。
- 根 `package.json` 增加 workspace 项。
- 增加一个 changeset/release intent，记录该新包的首次发布决定。
- 运行时依赖 Harness 的 `sessionTitle`、`llm` 和 Settings/Remote UI 服务；不会改动现有 session 事件模型。
