# Agent 指令审计报告

基线：`b21d47c`（`origin/main`）。首稿基于 `b8c0c39`，Pi E2E 套件合入后已重建。

## 假设

- **范围**：`AGENTS.md`、`CLAUDE.md`、`docs/`、`pi-extension-dev` skill、根与 12 个包的 `openspec/config.yaml`、根 `README.md`，以及 6 个需要限定命令范围的已发布 README。
- **未纳入**：生成的 `.agents/skills/openspec-*`、已发布的 `pi-ask/skills/ask-user`、用户级配置。
- **目标模型**：Claude Opus 5.5。
- **隔离规则的例外**：修改两个体系共用的根工具时运行仓库级检查；只服务 Pi 的根工具（`scripts/e2e/pi/`、`pi-host-rehearsal.yml`、`node-pty`）只验证 Pi。

## 主要发现

1. **验证路径跨体系**：指令最终都指向根 `npm run check`，它覆盖全部包，并需要 dsh 的 `pnpm` 和 Chromium。
2. **发布默认跨体系**：`npm run release:version` 会消费两个体系的全部 intent。
3. **文档以 Pi 为中心**：`docs/conventions.md` 自称只管 `pi-*/`，却规定 dsh 测试；创建包的步骤混在一起且编号错乱；dsh 没有 API 查询入口。

第 1 组 0 条，第 2 组 13 条，第 3 组 0 条，第 4 组不适用。用户要求的第 1 点已满足：`CLAUDE.md` 已是 `@AGENTS.md`。

## 发现（行号指 `b21d47c`）

| 位置                                          | 问题                                                        | 置信度 | 处理          |
| --------------------------------------------- | ----------------------------------------------------------- | ------ | ------------- |
| `docs/architecture.md:14`                     | 工作流列表缺 `pi-host-rehearsal.yml`                        | 高     | 补全          |
| `docs/architecture.md:22,31`                  | 目录树缺 `dsh-<topic>/`，包列表只有 8 个                    | 高     | 改写          |
| `docs/architecture.md:35`                     | 称包的测试都在包内，Pi 场景实际在 `scripts/e2e/pi/`         | 高     | 改写          |
| `docs/architecture.md` Manifest 节            | “the dsh package” 单数                                      | 高     | 改写          |
| `openspec/config.yaml:16`                     | 写 9/6/3 个包，实际 12/8/4                                  | 高     | 不写数量      |
| `docs/workflow.md:28-36`                      | 步骤编号错乱，第 2 步并入第 6 行                            | 高     | 拆成两份文档  |
| `docs/workflow.md:36-65`                      | 新 Pi 包缺 `registrations.ts` 步骤，`test:e2e:pi` 会失败    | 高     | 补步骤        |
| `docs/conventions.md` 开头、Documentation 节  | 范围声明与 dsh 规则矛盾                                     | 高     | 改写          |
| `docs/conventions.md` TypeScript 节           | `tsconfig` 的 `include` 说法不符                            | 高     | 改写为规则    |
| `README.md` 安装列表                          | 缺 `pi-ask` 和 `dsh-custom-provider-reasoning-efforts`      | 高     | 补全          |
| `openspec/specs/agent-guidance/spec.md:14-30` | 仍要求记录 sub2api 延期和“每个测试都走宿主”，与现行规则矛盾 | 高     | 改 spec       |
| `docs/releases.md` 第一次运行相关行           | 一次性历史叙述                                              | 中     | 删除并改 spec |
| `docs/pi-reference.md` 版本表                 | 与各 `package.json` 重复                                    | 中     | 改成规则      |

## 按要求做的结构改动

| 位置                                             | 改动                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                      | 从 10.4 KB 缩到 3.6 KB，保留隔离规则、始终适用的规则和路由表                                |
| `docs/pi/`、`docs/dsh/`                          | 按体系拆分；Pi 测试规则、场景测试和发布预演进 `docs/pi/README.md`；新增 dsh 的 API 查询入口 |
| `docs/releases.md`                               | 从 43 KB 降到 11.6 KB；CI 与首发流程移到 `docs/releases/`，程序内容不削弱                   |
| `docs/workflow.md`                               | 按改动范围区分单包、单体系、Pi 专属工具和共享工具                                           |
| skill、`openspec/config.yaml`、6 个已发布 README | 改用隔离命令，6 个 README 各记录一个 `none` intent                                          |

## 仅标记，未改

- **CI 仍跨体系**：`lint.yml` 和 `publish.yml` 运行根检查，一个体系的失败会阻塞另一个体系的发布。是否拆分由仓库所有者决定。

## 验证

| 检查                                               | 结果              |
| -------------------------------------------------- | ----------------- |
| `pi-skill`、`dsh-thread-summary` 的单包 `test:e2e` | 通过              |
| `pi-skill` 场景测试                                | 6 个通过          |
| `npm run test:scripts`、根 `tsc`、`lint:tooling`   | 通过（85 个测试） |
| 隔离发布命令（scratch 副本，zsh 和 bash）          | 只动目标体系      |
| 发布影响 gate（临时提交）                          | 通过              |
| `oxfmt`、OpenSpec 校验、文档路径与章节引用         | 通过              |

**未完成**：根 `npm run check`、`npm run test:e2e`、`npm run test:e2e:pi` 按所有者要求不再全量运行，交给 CI。第一次 `npm run check` 的输出在 `pi-ask` 测试后结束，没有出现 `test:scripts`，退出码也没有捕获，原因未确定；第二次运行在 `dsh-autocompact` 阶段被手动停止，此前无失败。`dsh plugin --profile` 实机安装和 Pi 交互式 live 检查也未运行。
