/**
 * A configurable row that accepts the deployment's provider table but refuses
 * the capability fields this plugin writes.
 *
 * It is valid at boot, so the real settings service describes it, and its
 * `resolveConfig()` rejects a write that adds `reasoningEfforts` — the real
 * counterpart of a Loader that refuses a configuration save.
 */

import z from "@deepseek-ai/schemastery";

const providers = z.dict(z.any()).default({});

export const Config = z.object({
  providers: z
    .transform(providers, (value) => {
      if (JSON.stringify(value).includes("reasoningEfforts")) {
        throw new Error("this profile refuses reasoningEfforts");
      }
      return value;
    })
    .volatile(),
});

export function apply(): void {}
