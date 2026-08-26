# @indexyz/pi-continue

A pi extension that adds `/continue` for resuming the most recently interrupted turn with the currently selected model.

## Install

```bash
pi install npm:@indexyz/pi-continue
```

For local development:

```bash
pi -e ./pi-continue/index.ts
```

## Usage

1. Interrupt a running turn (for example, with Escape).
2. Optionally select another model with `/model`.
3. Run `/continue`.

```text
/continue
```

`/continue` takes no arguments. In particular, no `--model provider/model` option is needed: pi runs the continuation through its normal prompt pipeline using whichever model is selected when the command executes.

The command waits for the interrupted run to settle, verifies that the current branch ends in an aborted assistant turn, and asks the active model to inspect the conversation and workspace before resuming the first unfinished step. Model and thinking-level changes recorded after the interruption do not hide the interrupted turn.

中断后可以先用 `/model` 切换模型，再运行 `/continue`；恢复请求会由当前选中的新模型执行。

## Development

```bash
npm install
npm run check --workspace @indexyz/pi-continue
```

## Release

The repository's `v*` tag workflow checks all workspaces and publishes every local version that is not already on npm. Configure `@indexyz/pi-continue` as an npm trusted publisher for `5aaee9/pi-agent-extensions` and `.github/workflows/publish.yml`; the workflow uses short-lived OIDC credentials instead of a stored npm token.

## License

MIT
