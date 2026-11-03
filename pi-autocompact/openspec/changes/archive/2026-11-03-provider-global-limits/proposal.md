# Proposal

## Why

A threshold can only be set per `provider/modelId`. To compact earlier on every model of a provider, or on every model at all, a user has to save one entry per model. A provider-level cap and a global cap, optionally relative to each model's context window, cover this with one setting each.

## What Changes

- New user settings `piAutocompact.providerLimits["<provider>"]` and `piAutocompact.globalLimit`. Both are **caps**: the effective threshold for a model is the minimum of its threshold (session override, otherwise saved model limit), its provider cap, the global cap, and the model's context window.
- A cap with no model threshold still applies on its own. A model threshold can lower a cap but cannot raise it.
- Every limit value, including `modelLimits` and the command argument, can be an absolute token count (`300k`, `300000`) or a percentage of the current model's context window (`80%`, stored as the string `"80%"`).
- `/autocompact <value> --save-provider` saves the provider cap for the current model's provider, and `/autocompact <value> --save-global` saves the global cap. `--save` keeps saving the model limit. The three flags are mutually exclusive.
- `/autocompact off` now also ignores provider and global caps for the current model in this session. `/autocompact default` restores them.
- When the effective threshold is at or above the context window, or at or below `keepRecentTokens`, the plugin does not compact that model. Status reports why.
- The status message names which level set the effective threshold.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autocompact-thresholds`: add provider and global caps, percentage values, the minimum rule, the two new save flags, and `off` covering caps.

## Impact

- `settings.ts` (grammar, defaults parsing, resolution, merge-and-save) and the `/autocompact` handler and boundary/input checks in `index.ts`.
- User `settings.json` gains two optional keys; `modelLimits` values may now also be percentage strings. Existing settings keep working unchanged.
- Tests, package README, root README table if its description changes, and a minor release intent for `@indexyz/pi-autocompact`.
- No new dependency and no change to the pinned Pi version.
