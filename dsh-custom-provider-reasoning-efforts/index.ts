/**
 * Declare reasoning efforts for hand-written dsh provider routes.
 *
 * A provider route the installed pi-ai catalog does not ship inherits no
 * reasoning capability, so `llm-pi-ai` resolves every one of its models to
 * `reasoning: false` and the model-selection menu offers no levels — even when
 * the gateway itself advertises them. The only field that fixes that is the
 * route model entry's `reasoningEfforts`, and the only seam through which
 * another plugin can supply it is the `volatile` `providers` field of the
 * `llm-pi-ai` row, written through the Harness settings service.
 *
 * This plugin owns that write. Declarations live in its own row configuration
 * (`providers`), and `/reasoning-efforts` plans or applies them; when a route
 * declares its levels at `/v1/models`, a discovery pass reads them and fills
 * the same field. An explicit declaration always wins over a discovered one,
 * and nothing is invented: a route or model the profile does not already
 * declare is reported and skipped.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts
 */

import z from "@deepseek-ai/schemastery";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand";
import type { Context } from "@deepseek-ai/cordis";
import type { CommandInvocation, CommandResult } from "@deepseek-ai/dsh-commands";
import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";

import type { ProviderDescriptor, SettingsSeam } from "./apply.ts";
import { validateDeclarations, type Declarations } from "./declarations.ts";
import {
  createRuntime,
  describeResult,
  runUntilAvailable,
  type CredentialSeam,
  type LoggerSeam,
  type RunMode,
  type RunSummary,
} from "./runtime.ts";

/** Plugin identity used by the Loader and by diagnostics. */
export const name = "custom-provider-reasoning-efforts";

/** Host-plane services this plugin needs before it can register its command. */
export const inject = ["commands"];

/** The answer every unrecognized argument receives. */
const USAGE = "Usage: /reasoning-efforts [status | apply | discover | clear]";

/**
 * Row configuration as `apply` receives it.
 *
 * `providers` is the declaration table; the rest tune the passes.
 */
export interface ReasoningEffortsConfig {
  /** Declarations keyed by provider route and then by exact model id. */
  providers?: Declarations;
  /** Whether the load-time pass interrogates endpoints (default true). */
  discover?: boolean;
  /** Routes to interrogate instead of the heuristic's own set (default: none). */
  discoverRoutes?: readonly string[];
  /** The configurable namespace whose `providers` field is written (default `llm-pi-ai`). */
  namespace?: string;
  /** Whether the load-time pass writes at all (default true). */
  applyOnLoad?: boolean;
}

/**
 * Validated row configuration; a malformed declaration fails plugin load.
 *
 * The declaration table keeps the same value grammar `llm-pi-ai` itself
 * accepts for `reasoningEfforts`: an effort dict, or `false` for a model that
 * cannot reason. Its levels are validated semantically by
 * {@link validateDeclarations}, because a dict's keys are not schema-constrained.
 */
export const Config = z.object({
  providers: z
    .dict(z.dict(z.union([z.const(false), z.dict(z.union([z.string(), z.const(null)]))])))
    .default({}),
  discover: z.boolean().default(true),
  discoverRoutes: z.array(z.string()).default([]),
  namespace: z.string().default("llm-pi-ai"),
  applyOnLoad: z.boolean().default(true),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The launcher's readiness signal, when this composition provides one. */
interface AppReadySeam {
  onReady(listener: () => void): () => void;
}

/**
 * Adapt the settings service to the seam the pass uses.
 *
 * The service is resolved on every pass, so a namespace mounted after this
 * plugin still reaches it, and a composition without the service degrades to
 * "unavailable" instead of failing the load.
 */
function settingsSeam(ctx: Context): (() => SettingsSeam | undefined) | undefined {
  return () => {
    const settings: unknown = ctx.get("settings");
    if (!isRecord(settings)) return undefined;
    const describe = settings["describe"];
    const update = settings["update"];
    if (typeof describe !== "function" || typeof update !== "function") return undefined;
    const writable = Reflect.get(settings, "writable");
    return {
      writable: typeof writable === "boolean" ? writable : true,
      describe: (): readonly ProviderDescriptor[] =>
        (describe.call(settings) as readonly SettingsDescriptor[]).map((entry) => ({
          ns: String(entry.ns),
          revision: entry.revision,
          value: entry.value,
          user: entry.user,
        })),
      update: async (ns, patch, expectedRevision) => {
        await (update.call(settings, ns, patch, expectedRevision) as Promise<unknown>);
      },
    };
  };
}

/** Adapt the credentials service to the seam the pass uses. */
function credentialsSeam(ctx: Context): (() => CredentialSeam | undefined) | undefined {
  return () => {
    const credentials: unknown = ctx.get("credentials");
    if (!isRecord(credentials)) return undefined;
    const resolve = credentials["resolve"];
    if (typeof resolve !== "function") return undefined;
    return {
      resolve: async (ref) =>
        (await (resolve.call(credentials, ref) as Promise<
          { readonly value: string } | undefined
        >)) ?? undefined,
    };
  };
}

/** Adapt the Cordis logger to the seam the pass uses. */
function loggerSeam(ctx: Context): LoggerSeam {
  return {
    debug: (line) => {
      ctx.logger.debug(line);
    },
    info: (line) => {
      ctx.logger.info(line);
    },
    warn: (line) => {
      ctx.logger.warn(line);
    },
  };
}

/** The launcher's readiness signal, when it exposes the documented shape. */
function appReadyOf(ctx: Context): AppReadySeam | undefined {
  const ready: unknown = ctx.get("appReady");
  if (!isRecord(ready)) return undefined;
  const onReady = ready["onReady"];
  if (typeof onReady !== "function") return undefined;
  return {
    onReady: (listener) => onReady.call(ready, listener) as () => void,
  };
}

/** Map one argument to a pass mode. */
function parseMode(raw: string): RunMode | undefined {
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "status") return "status";
  if (value === "apply" || value === "discover" || value === "clear") return value;
  return undefined;
}

/** Log one load-time outcome without ever surfacing it as a load failure. */
function logLoadOutcome(logger: LoggerSeam, summary: RunSummary): void {
  const text = describeResult(summary);
  if (summary.result.kind === "applied") logger.info(text);
  else if (summary.result.kind === "pending") logger.debug(text);
  else logger.debug(text);
  for (const failure of summary.failures) {
    logger.warn(`reasoning-efforts: discovery failed for ${failure}`);
  }
}

/**
 * Register the `/reasoning-efforts` command and the load-time pass.
 *
 * @param ctx - Host-plane context carrying the command registry.
 * @param config - validated row configuration; a malformed declaration throws here.
 */
export function apply(ctx: Context, config: ReasoningEffortsConfig = {}): void {
  const declarations = validateDeclarations(config.providers);
  const namespace =
    typeof config.namespace === "string" && config.namespace.length > 0
      ? config.namespace
      : "llm-pi-ai";
  const discover = config.discover !== false;
  const runtime = createRuntime(
    {
      namespace,
      declarations,
      discover,
      discoverRoutes: config.discoverRoutes ?? [],
    },
    {
      settings: settingsSeam(ctx),
      credentials: credentialsSeam(ctx),
      logger: loggerSeam(ctx),
    },
  );

  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const mode = parseMode(invocation.rawInput);
    if (mode === undefined) return { kind: "error", text: USAGE };
    try {
      const summary = await runtime.run(mode, invocation.signal);
      return { kind: "success", text: describeResult(summary) };
    } catch (error) {
      return { kind: "error", text: `reasoning-efforts: ${message(error)}` };
    }
  };

  ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: CommandDefinitionId("@indexyz/dsh-custom-provider-reasoning-efforts"),
        name: "reasoning-efforts",
        description:
          "Declare reasoningEfforts for hand-written provider routes: /reasoning-efforts [status | apply | discover | clear]",
        input: { hint: "status | apply | discover | clear" },
        handler,
      }),
    "dsh-custom-provider-reasoning-efforts command",
  );

  if (config.applyOnLoad === false) return;
  ctx.inject(["settings"], (child) => {
    const logger = loggerSeam(child);
    const start = (): void => {
      const mode: RunMode = discover ? "discover" : "apply";
      void runUntilAvailable(runtime, mode).then((outcome) => {
        if (outcome.error !== undefined) {
          logger.warn(`reasoning-efforts: the load-time pass failed: ${message(outcome.error)}`);
        }
        if (outcome.summary !== undefined) logLoadOutcome(logger, outcome.summary);
      });
    };
    const ready = appReadyOf(child);
    if (ready === undefined) {
      start();
      return;
    }
    child.effect(() => ready.onReady(start), "dsh-custom-provider-reasoning-efforts load pass");
  });
}
