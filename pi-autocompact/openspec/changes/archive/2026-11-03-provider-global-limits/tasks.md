# Tasks

## 1. Values and resolution

- [x] 1.1 Add the `LimitValue` parser for the command (`300k`, `0.3m`, `300000`, `80%`) and for settings (positive integer or `"<n>%"`, 0 < n ≤ 100), plus `resolveLimit`. Verify unit tests for valid forms, `0%`, `150%`, `abc`, negative and fractional token counts, and floor rounding.
- [x] 1.2 Parse `modelLimits`, `providerLimits`, and `globalLimit` into `PluginDefaults`, rejecting non-object containers, provider keys containing `/`, model keys without `/`, and invalid values. Verify existing integer-only settings parse unchanged.
- [x] 1.3 Implement `effectiveLimit` and `usableLimit`. Verify the spec scenarios: global alone, lowest level wins, session capped, cap above window, `off` ignores caps, ties report the more specific source, and below-`keepRecentTokens` is unusable.

## 2. Command grammar and saving

- [x] 2.1 Extend the parser with `--save-provider` and `--save-global`, mutually exclusive with `--save` and each other. Verify accepted positions and every rejected combination from the spec.
- [x] 2.2 Generalize the settings merge to the three targets and serialize percentages as strings. Verify unrelated keys, other limits, file mode, malformed JSON, non-object containers, and lock cleanup as in the existing save tests.

## 3. Wiring

- [x] 3.1 Use `effectiveLimit` and `usableLimit` in the boundary and input checks; skip unusable thresholds without a warning. Verify with the real-host tests: a global cap compacts with no model limit, a provider cap lowers a model limit, and an over-window cap does not compact or warn.
- [x] 3.2 Wire the new save flags in the handler: check native enablement, save, update in-memory defaults, keep the session override. Report the effective threshold, its source, and why it is unusable when it is. Verify handler tests for both flags, `off`/`default` with caps, and failed saves leaving file bytes and state unchanged.

## 4. Docs and release decision

- [x] 4.1 Update the package README (settings keys, percentages, minimum rule, flags, skip rule, rollback note) and the root README table description. Verify documented commands match the parser tests.
- [x] 4.2 Record a minor release intent for `@indexyz/pi-autocompact`. Verify `npm run change:status` lists it.

## 5. Integration

- [x] 5.1 Run `npm run check` from the repository root and the RPC load smoke with `pi-autocompact/node_modules/.bin/pi`. Verify both exit 0.
- [x] 5.2 Run `npx openspec validate provider-global-limits --strict` from `pi-autocompact/`. Verify it passes.
