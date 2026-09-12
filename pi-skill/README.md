# @indexyz/pi-skill

Codex-style `$skill-name` invocation anywhere in a pi prompt.

Pi expands skills only through the `/skill:name` command at the start of a message. This extension lets you reference loaded skills inline, while rendering every referenced skill as its own native, collapsible block:

```text
[skill] code-review (… to expand)

使用 $code-review 这个 skill review 代码
```

The model receives the same XML block Pi uses for `/skill:name`, as a separate context message before the original prompt:

```xml
<skill name="code-review" location="/path/to/code-review/SKILL.md">
References are relative to /path/to/code-review.

…skill instructions…
</skill>

使用 $code-review 这个 skill review 代码
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

Typing `$` at the start of a token (line start or after whitespace) opens an
autocomplete popup listing every loaded skill with its description, just like
`/skill:` completion. Suggestions fuzzy-match on the skill name.

- Works with every skill pi has loaded: global (`~/.pi/agent/skills`, `~/.agents/skills`), project (`.pi/skills`, `.agents/skills`), package, settings, and `--skill` paths — including skills marked `disable-model-invocation`, which never appear in the system prompt.
- Every distinct referenced skill gets its own native `[skill] name` block; use Pi's tool-output expansion key to reveal the full instructions.
- Each context message uses the same `<skill name="…" location="…">` format pi emits for `/skill:name`, so relative references inside the skill keep working.
- The original user prompt stays readable instead of being replaced by the full skill bodies.
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
