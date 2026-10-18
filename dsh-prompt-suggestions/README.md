# @indexyz/dsh-prompt-suggestions

Dim next-message suggestions for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) composer.

After a successful reply, the empty composer shows a short message the user is likely to send next. Press <kbd>Tab</kbd> or <kbd>→</kbd> to add it to the draft, then <kbd>Enter</kbd> yourself. Press <kbd>Esc</kbd> to dismiss it. The plugin never sends the suggestion automatically.

## Install

```bash
dsh plugin --profile web add @indexyz/dsh-prompt-suggestions
```

From a checkout, build the generated Host and browser artifacts first because a `link:` install reads files from disk without building:

```bash
npm install
npm run build --workspace @indexyz/dsh-prompt-suggestions
dsh plugin --profile web add ./dsh-prompt-suggestions
```

Restart the Harness for the Host half and refresh the page for the browser half. The bundle patch inserts the `prompt-suggestions` row automatically; no manual profile patch is needed.

## Settings

**Settings → General → Next-message suggestions** has one global switch. The value is stored in the `prompt-suggestions` Host settings namespace and applies immediately. The switch reports read-only profiles, revision conflicts, and unavailable settings without affecting the rest of the page.

## Behavior

- A suggestion is generated only after a **live completed turn** that contains a direct human message and visible assistant text. Failed, aborted, interrupted, blocked, max-token, text-free, restored, replayed, and replayed/forked turns do not trigger generation.
- The composer marks its session watched on the first query, even when the draft is not empty. A session whose composer was never open does not spend a request.
- The suggestion uses the conversation's current provider/model and the lowest reasoning effort that route advertises (`low`, then `off`/`minimal`/`none`, otherwise the lowest available).
- Only the **eight most recent visible user/assistant exchanges** are sent, bounded to 4,096 UTF-8 bytes. Reasoning, tool results, tool arguments, system prompts, synthetic context, attachments, hooks, connectors, and environment state are never sent.
- The auxiliary call is tool-free, writes no session events, inherits no goal, does not appear in the conversation, and is discarded after the turn. It has a **30-second deadline** and 512 output tokens.
- A new turn, session switch, or disabled switch invalidates the pending result and aborts the in-flight auxiliary call.

### Keys and priority

| Input                                  | Result                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| <kbd>Tab</kbd> / <kbd>→</kbd>          | Append the suggestion to the editable draft; no submit |
| <kbd>Esc</kbd>                         | Dismiss the suggestion                                 |
| Typing or pasting                      | Hides the suggestion; clearing the draft re-shows it   |
| Existing draft, attachment, open menu  | No ghost text / no key interception                    |
| Custom bare Tab or Right-Arrow binding | The custom shortcut wins                               |

IME composition is ignored, and the ghost row is hidden from the accessibility tree.

## Cost and privacy

Each eligible live reply adds **one auxiliary model request**. The request is real token and latency cost, so keep the switch off if that is not wanted. Opening a session after a reload does not generate for its already-completed history; the first live completed turn after the composer is watched does.

The suggestion is ephemeral Host memory: a reload, session replay, or Harness restart drops it. It is never persisted and never submitted. Model output is normalized to one plain-text line capped at 200 Unicode code points; empty, tool-call, non-stop, or malformed output produces no suggestion.

## Limits

- This package targets the pinned Harness version in its manifest and uses the composer's current DOM contract (`data-composer-card`, `data-composer-placeholder`, `contenteditable`). A composer rewrite may require a small update; failure degrades to no ghost text.
- A reasoning route can still return reasoning-only or truncated output. Those cases are treated as "no suggestion" rather than shown partially.
- The page reload/restored-turn behavior is intentional: replay is not a generation trigger.

## Development

```bash
npm run check --workspace @indexyz/dsh-prompt-suggestions
node dsh-prompt-suggestions/test/smoke-release.ts dsh-prompt-suggestions
```

The release smoke verifies the installed manifest, bundle patch, generated Host entry, browser module-loader registration, both slot registrations, locale copy, and disposal. The package declares this script as `release.smoke`, so the release engine runs the same check against the packed and installed tarball.

The Host half builds to `lib/` with `tsc`; the browser half builds to one `client.js` with `tsdown`. Both are Git-ignored and built by `prepack`. The `openspec/` directory is development-only and excluded from the tarball.

## License

MIT
