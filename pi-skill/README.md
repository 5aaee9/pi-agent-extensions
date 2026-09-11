# @indexyz/pi-skill

Codex-style `$skill-name` invocation anywhere in a pi prompt.

Pi expands skills only through the `/skill:name` command at the start of a message. This extension lets you reference a loaded skill inline, the way Codex's `$skill` syntax works:

```text
使用 $code-review 这个 skill review 代码
```

is rewritten before the model sees it to:

```xml
<skill name="code-review" location="/path/to/code-review/SKILL.md">
References are relative to /path/to/code-review.

…skill instructions…
</skill>

使用  这个 skill review 代码
```

## Install

```bash
pi install npm:@indexyz/pi-skill
```

For local development:

```bash
pi -e ./pi-skill/index.ts
```

## Usage

Type `$` followed by a skill name anywhere in your prompt:

```text
$code-review                          # whole prompt is the skill
请先 $code-review 一下最近的改动       # inline, mid-sentence
对比 $code-review 和 $simplify-codebase 两份检查清单
```

- Works with every skill pi has loaded: global (`~/.pi/agent/skills`, `~/.agents/skills`), project (`.pi/skills`, `.agents/skills`), package, settings, and `--skill` paths — including skills marked `disable-model-invocation`, which never appear in the system prompt.
- Expansion uses the same `<skill name="…" location="…">` block pi emits for `/skill:name`, so relative references inside the skill keep working.
- A token that matches no loaded skill is left untouched, so `$HOME` or `$9.99` in prose is safe.
- Write `$$name` for a literal `$name`.

## Development

```bash
npm install
npm run check --workspace @indexyz/pi-skill
```

## Release

The repository's `v*` tag workflow checks all workspaces and publishes every local version that is not already on npm. Configure `@indexyz/pi-skill` as an npm trusted publisher for `5aaee9/pi-agent-extensions` and `.github/workflows/publish.yml`; the workflow uses short-lived OIDC credentials instead of a stored npm token.

## License

MIT
