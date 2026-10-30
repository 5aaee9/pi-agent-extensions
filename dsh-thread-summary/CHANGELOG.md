# Changelog

## 0.1.2

### Patch Changes

- Rebuilt and retested against the dsh 0.2.2-alpha.2 host line, where the session title service also uses the agents service.

## 0.1.1

### Patch Changes

- Release the complete session-title plugin with configurable summary models, native DSH settings controls, bounded generation, deterministic fallback and manual-rename protection. Verify the installed package and browser module for the GitHub Actions release.

## 0.1.0

- Generate concise session titles from the first user message with a separately configurable summary model.
- Configure the provider, model and automatic-title switch in General settings using native DSH controls, light/dark themes and responsive layout.
- Bound prompts and Unicode-safe titles, enforce a 60-second deadline, and retain deterministic fallback and manual renames when generation fails or is cancelled.
- Handle loading, read-only settings, save errors and revision conflicts; verify the packaged browser module and host title lifecycle.
