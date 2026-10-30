/**
 * The configurable plugin row the deployment uses for the route table.
 *
 * The real `llm-pi-ai` adapter is not part of this package's pinned closure, so
 * the test profile supplies the one field the plugin writes — a `volatile`
 * `providers` dict, exactly as that adapter's Config declares it. The row is
 * loaded by the real Loader alongside the real settings service, so
 * `settings.describe()` and `settings.update()` validate and persist against a
 * live plugin schema rather than a hand-built descriptor.
 */

import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  providers: z.dict(z.any()).default({}).volatile(),
});

export function apply(): void {}
