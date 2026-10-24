# Design

## Context

See `proposal.md` for why. Today `index.ts` keeps session overrides in a `Map` and loads `defaultLimits()` from user `settings.json` on `session_start`. `readSettings()` returns `{}` when the file is missing and throws on malformed JSON without creating or rewriting it. Pi 0.87.1's public `SettingsManager` persists only fields it knows about; `piAutocompact` is not one of them. Its file writer re-reads `settings.json` under a `proper-lockfile` lock directory named `<settings.json>.lock` and spreads unknown keys back, so a direct merge of `piAutocompact` survives a later Pi save when the two writers do not race.

## Goals / Non-Goals

**Goals:**

- One parser for the command text, testable without Pi.
- One merge of the current model key into the latest user-settings object, testable without Pi.
- The handler applies a validated session override and, only for `--save`, writes that same integer first.

**Non-Goals:**

- Saving `off` or `default`, writing project settings, or adding a settings schema Pi reloads live inside the current process.
- Changing boundary compaction, native `compaction` settings, or `dsh-autocompact`.

## Decisions

### 1. Parse tokens, then the existing numeric grammar

**Choice:** Split arguments on whitespace. `--save` (any case) is the only flag, at most once, in either position. The remaining token is `off`, `default`, or a value for the existing `parseLimit` grammar. Anything else throws before session or disk state changes.

**Why:** The current handler lowercases the entire argument string, so `300k --save` cannot be a limit. Tokenizing keeps `parseLimit` strict (it still rejects `300k extra`) and makes the nonsensical combinations explicit.

**Alternative considered:** A second command such as `/autocompact-save`. Rejected: the request is a flag on the existing command.

### 2. Write user settings directly, under Pi's lock directory

**Choice:** `saveModelLimit(path, modelKey, limit)` resolves `join(getAgentDir(), "settings.json")` — the path `getSettingsPath()` uses, which is not exported from Pi 0.87.1. It acquires `<resolved>.lock` by `mkdir` (the same atomic directory lock `proper-lockfile` uses, stale after 10 seconds), reads the file, merges, and replaces the file with a temp write, `fsync`, and `rename`. In-process saves share one queue. No new dependency.

**Why:** `SettingsManager` has no public setter for an unknown key. `FileSettingsStorage` is not exported. Reading and writing the file this package already reads keeps one store. The lock directory matches Pi so a concurrent Pi save cannot drop `piAutocompact` or let this write drop Pi's keys. The merge copies `piAutocompact` and `modelLimits` and sets one key; other top-level keys stay by object spread. An existing file keeps its mode.

**Alternative considered:** Depend on `proper-lockfile`. Rejected: the host already locks with an empty directory, and a second copy of the library is not needed to take that directory.

**Alternative considered:** Call private `SettingsManager` methods. Rejected: they are not part of the extension surface.

### 3. Persist only after validation, then mirror the default in memory

**Choice:** The handler validates the limit against `keepRecentTokens` and the context window, and requires native automatic compaction, before `saveModelLimit`. On success it sets the session override and `defaults` for that key. On failure it throws before either update.

**Why:** The session that saved must compact immediately, and `/autocompact default` in that same session must inherit the value just written. The in-memory map is otherwise loaded only in `session_start`, which is what a later session and `/reload` already do. Updating it here does not change that load path.

### 4. Report save and non-save differently

**Choice:** A successful `--save` says the value was saved as the global default. Every other successful invocation keeps the current "No settings written." sentence.

**Why:** The old sentence is the contract for the session-only path. The save path must not claim that.

## Risks / Trade-offs

- **A crash while the lock directory exists** → the next save treats it as stale after 10 seconds and removes it; until then the command errors and writes nothing.
- **Rewriting `settings.json` reformats it** → the merge preserves keys and values, not original whitespace. Pi's own saver reformats the same way.
- **A relative `PI_CODING_AGENT_DIR`** → the write resolves the path before locking so the lock matches Pi's resolved settings path. Reads on session start keep using `join(getAgentDir(), "settings.json")`, which is the same absolute path Pi uses for the default and tilde-expanded agent directory.
- **Another process saves the same key at the same time** → the lock serializes the read-merge-write; the last completed save wins for that key.

## Migration Plan

No migration. Existing hand-written `modelLimits` entries stay valid. Removing a saved default is still a manual edit of that key. Rolling back the package leaves the settings key in place and ignores it, which is the previous behavior for an unknown plugin default when the plugin is absent.
