# Release intents

Each `.md` file in this directory (other than this README) is a release intent: a
decision about one package's next release, recorded in the change that needs it.

```md
---
"@indexyz/pi-skill": patch
---

User-facing summary of the change; it becomes the changelog entry.
```

- Name exactly one package per file, by its full npm name `@indexyz/<name>`.
- Use `patch`, `minor`, or `major` for a change that should ship, or `none` with
  the reason no release is needed.
- Record a positive intent with
  `npm run change -- --patch @indexyz/<name> -m "<summary>"`; write a `none`
  intent by hand.

The full procedure is in [`docs/releases.md`](../docs/releases.md).
