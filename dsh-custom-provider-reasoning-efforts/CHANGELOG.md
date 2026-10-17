# Changelog

## 0.1.0 - 2026-10-17

- Initial release.
- Declare `reasoningEfforts` for a hand-written `llm-pi-ai` provider route, whose models otherwise resolve to `reasoning: false` because the installed pi-ai catalog ships no entry to inherit from.
- Carry the declarations in the plugin row's own `providers` table, keyed by provider route and exact model id, with each level mapped to the wire spelling it dispatches and `false` for a model that cannot reason; a malformed declaration fails the load, naming the route, the model, and the level.
- Write the missing field through the Harness settings service over the `llm-pi-ai` row's volatile `providers` field, so the change reaches the running adapter without a restart; only models the profile already declares are filled, and nothing is invented.
- Interrogate a custom route's `/v1/models` for the levels it advertises (`reasoning`, `supported_reasoning_levels`, and their sibling spellings) and map them onto the models the route declares, with endpoint failures contained to a warning.
- Add `/reasoning-efforts` with `status`, `apply`, `discover`, and `clear`, reporting every change, every already-current pair, and every skip with its reason.
- Run the pass once after startup, through the launcher's readiness signal when one exists, so a declaration lands without a restart and an unreachable gateway never blocks or fails boot.
