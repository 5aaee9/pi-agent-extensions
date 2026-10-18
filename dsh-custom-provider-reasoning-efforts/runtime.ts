/**
 * The plugin's pass: turn declarations and endpoint discovery into the
 * `providers` intents the settings write consumes.
 *
 * Everything here is transport- and service-agnostic so it can be driven by the
 * real Harness or by a fake with the same shape: the settings seam, the
 * credential seam, the logger, and the transport are injected, and the pass
 * reports what it probed, what it changed, what it skipped, and what failed
 * instead of throwing them away.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/runtime
 */

import type { ProviderDescriptor, SettingsSeam, ApplyResult } from "./apply.ts";
import { applyIntents } from "./apply.ts";
import {
  describeEfforts,
  describeInput,
  isModelInput,
  type Declarations,
  type InputDeclarations,
} from "./declarations.ts";
import { hasCodexManifest, probeManifest, probeRoute, type RouteProbe } from "./discovery.ts";
import type { Change, Intent, Skip } from "./plan.ts";
import type { ListedModel } from "./reasoning.ts";

/** How many lines of changes or skips one answer lists before summarizing. */
const MAX_LISTED = 5;

/** The credential half of the credentials service this plugin uses. */
export interface CredentialSeam {
  /** Resolve one credential reference. */
  resolve(ref: string): Promise<{ readonly value: string } | undefined>;
}

/** The logger shape this plugin uses. */
export interface LoggerSeam {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

/** Everything the pass needs from its host. */
export interface RuntimeDeps {
  /** Resolve the settings seam per pass, so a late-mounted service is still seen. */
  readonly settings?: () => SettingsSeam | undefined;
  /** Resolve the credential seam per pass; absent means environment-only resolution. */
  readonly credentials?: () => CredentialSeam | undefined;
  readonly logger: LoggerSeam;
  /** Transport override, for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Environment override, for tests; the process environment by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The row configuration's resolved runtime inputs. */
export interface RuntimeOptions {
  /** The configurable namespace whose `providers` field is written. */
  readonly namespace: string;
  /** The validated effort declaration table. */
  readonly declarations: Declarations;
  /** The validated vision declaration table. */
  readonly inputs: InputDeclarations;
  /** Whether the load-time pass interrogates endpoints. */
  readonly discover: boolean;
  /** Routes to interrogate instead of the heuristic's own set. */
  readonly discoverRoutes: readonly string[];
}

/** One pass's mode. */
export type RunMode = "status" | "apply" | "discover" | "clear";

/** What one pass did. */
export interface RunSummary {
  readonly mode: RunMode;
  readonly namespace: string;
  readonly result: ApplyResult;
  /** How many route/model pairs the pass planned. */
  readonly intents: number;
  /** Routes whose endpoint was interrogated. */
  readonly probed: readonly string[];
  /** Routes whose interrogation failed, with the reason. */
  readonly failures: readonly string[];
}

/** The pass entry point. */
export interface Runtime {
  run(mode: RunMode, signal?: AbortSignal): Promise<RunSummary>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `providers` table one descriptor layer carries, when it carries one. */
function providersOf(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providers = value["providers"];
  return isRecord(providers) ? providers : undefined;
}

/** The model ids one route's explicit `models` list declares. */
function declaredModelIds(route: Record<string, unknown> | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  const models = route?.["models"];
  if (Array.isArray(models)) {
    for (const entry of models) {
      if (isRecord(entry) && typeof entry["id"] === "string") ids.add(entry["id"]);
    }
  }
  return ids;
}

/** A string-valued record, or `undefined` when the value is not one. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

/** Every declared route/model pair, with its reasoning declaration. */
function declaredIntents(declarations: Declarations): Intent[] {
  const intents: Intent[] = [];
  for (const [route, models] of Object.entries(declarations)) {
    for (const [model, value] of Object.entries(models)) intents.push({ route, model, value });
  }
  return intents;
}

/** Every declared route/model pair, as a reasoning removal. */
function removalIntents(declarations: Declarations): Intent[] {
  const intents: Intent[] = [];
  for (const [route, models] of Object.entries(declarations)) {
    for (const model of Object.keys(models)) {
      intents.push({ route, model, value: undefined });
    }
  }
  return intents;
}

/** Every declared route/model pair, with its vision declaration. */
function declaredInputIntents(inputs: InputDeclarations): Intent[] {
  const intents: Intent[] = [];
  for (const [route, models] of Object.entries(inputs)) {
    for (const [model, value] of Object.entries(models)) {
      intents.push({ field: "input", route, model, value });
    }
  }
  return intents;
}

/** Every declared route/model pair, as a vision removal. */
function removalInputIntents(inputs: InputDeclarations): Intent[] {
  const intents: Intent[] = [];
  for (const [route, models] of Object.entries(inputs)) {
    for (const model of Object.keys(models)) {
      intents.push({ field: "input", route, model, value: undefined });
    }
  }
  return intents;
}

/** The identity one intent addresses: pair plus the field it writes. */
function intentKey(intent: Intent): string {
  return `${intent.route}\u0000${intent.model}\u0000${intent.field ?? "reasoningEfforts"}`;
}

/** An explicit declaration wins over a discovered one for the same pair and field. */
function mergeIntents(explicit: readonly Intent[], discovered: readonly Intent[]): Intent[] {
  const merged = new Map<string, Intent>();
  for (const intent of [...discovered, ...explicit]) merged.set(intentKey(intent), intent);
  return [...merged.values()];
}

/**
 * The routes a discovery pass interrogates.
 *
 * The heuristic's set is the profile's own hand-written routes: those that
 * declare an explicit, non-empty `models` list and a `baseURL`. A non-empty
 * `discoverRoutes` names the set instead.
 */
function candidateRoutes(
  options: RuntimeOptions,
  user: Record<string, unknown> | undefined,
  effective: Record<string, unknown> | undefined,
): string[] {
  if (options.discoverRoutes.length > 0) return [...options.discoverRoutes];
  const routes: string[] = [];
  for (const [route, entry] of Object.entries(user ?? {})) {
    if (!isRecord(entry)) continue;
    if (declaredModelIds(entry).size === 0) continue;
    const resolved = isRecord(effective?.[route]) ? effective[route] : entry;
    const baseURL = resolved["baseURL"];
    if (typeof baseURL !== "string" || baseURL.length === 0) continue;
    routes.push(route);
  }
  return routes;
}

/** Resolve one route's credential reference, through the store and then the environment. */
async function resolveApiKey(deps: RuntimeDeps, ref: unknown): Promise<string | undefined> {
  if (typeof ref !== "string" || ref.length === 0) return undefined;
  const credentials = deps.credentials?.();
  if (credentials !== undefined) {
    try {
      const resolved = await credentials.resolve(ref);
      if (resolved !== undefined && resolved.value.length > 0) return resolved.value;
    } catch (error) {
      deps.logger.warn(`could not resolve the credential ${ref}: ${message(error)}`);
    }
  }
  const value = (deps.env ?? process.env)[ref];
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** What one discovery pass produced. */
interface DiscoveryOutcome {
  readonly intents: readonly Intent[];
  readonly probed: readonly string[];
  readonly failures: readonly string[];
}

/**
 * Whether a route's own listing left something for its Codex manifest to answer.
 *
 * The manifest costs a second request, so it is consulted only when the listing
 * described no thinking level for at least one model the route declares — the
 * state a Codex relay that publishes no capability in `/v1/models` is in.
 */
function needsManifest(
  api: string,
  listed: readonly ListedModel[],
  declared: ReadonlySet<string>,
): boolean {
  if (!hasCodexManifest(api) || declared.size === 0) return false;
  const levelled = new Set(
    listed.filter((model) => model.efforts !== undefined).map((model) => model.id),
  );
  for (const id of declared) if (!levelled.has(id)) return true;
  return false;
}

/**
 * Merge a manifest's models into a listing's.
 *
 * A model the listing already describes keeps its own wire spellings and gains
 * the manifest's additional levels; a model only the manifest describes is
 * added, so an inventory that omits a model does not hide the manifest's answer
 * for it.
 */
function mergeListings(
  listed: readonly ListedModel[],
  manifest: readonly ListedModel[],
): ListedModel[] {
  const merged = new Map<string, ListedModel>();
  for (const model of listed) merged.set(model.id, model);
  for (const model of manifest) {
    const existing = merged.get(model.id);
    if (existing === undefined) {
      merged.set(model.id, model);
      continue;
    }
    const efforts = model.efforts ?? existing.efforts;
    const inputModalities = existing.inputModalities ?? model.inputModalities;
    const name = existing.name ?? model.name;
    const contextWindow = existing.contextWindow ?? model.contextWindow;
    const maxTokens = existing.maxTokens ?? model.maxTokens;
    merged.set(model.id, {
      id: model.id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(efforts === undefined ? {} : { efforts }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    });
  }
  return [...merged.values()];
}

/**
 * The metadata intents one listing entry supplies.
 *
 * Discovery fills an authored entry's gaps only: each intent uses the `fill`
 * mode, so a value the profile already carries — the deployment's own choice —
 * is never overwritten. `name`, `contextWindow`, and `maxTokens` are the fields
 * a bare inventory (a Codex manifest, a relay that omits limits) leaves unset
 * and the Harness would otherwise fill from its defaults or the installed
 * catalog.
 *
 * @param model - one merged listing entry.
 * @returns the metadata intents to plan beside the capability ones.
 */
function discoveredMetadata(model: ListedModel): Array<{
  readonly field: "name" | "contextWindow" | "maxTokens";
  readonly mode: "fill";
  readonly value: string | number;
}> {
  const intents: Array<{
    readonly field: "name" | "contextWindow" | "maxTokens";
    readonly mode: "fill";
    readonly value: string | number;
  }> = [];
  if (model.name !== undefined) intents.push({ field: "name", mode: "fill", value: model.name });
  if (model.contextWindow !== undefined) {
    intents.push({ field: "contextWindow", mode: "fill", value: model.contextWindow });
  }
  if (model.maxTokens !== undefined) {
    intents.push({ field: "maxTokens", mode: "fill", value: model.maxTokens });
  }
  return intents;
}

/** Interrogate every candidate route and turn the advertised levels into intents. */
async function discoverIntents(
  deps: RuntimeDeps,
  options: RuntimeOptions,
  descriptor: ProviderDescriptor,
  signal: AbortSignal | undefined,
): Promise<DiscoveryOutcome> {
  const user = providersOf(descriptor.user);
  const effective = providersOf(descriptor.value) ?? user;
  const intents: Intent[] = [];
  const probed: string[] = [];
  const failures: string[] = [];
  for (const route of candidateRoutes(options, user, effective)) {
    probed.push(route);
    const userRoute = isRecord(user?.[route]) ? user[route] : undefined;
    const effectiveRoute = isRecord(effective?.[route]) ? effective[route] : undefined;
    const profile = effectiveRoute ?? userRoute;
    if (profile === undefined) {
      failures.push(`${route}: the namespace does not declare that route`);
      continue;
    }
    const baseURL = profile["baseURL"];
    if (typeof baseURL !== "string" || baseURL.length === 0) {
      failures.push(`${route}: the route declares no baseURL to interrogate`);
      continue;
    }
    const api =
      typeof profile["api"] === "string" && profile["api"].length > 0
        ? profile["api"]
        : "openai-completions";
    const headers = stringRecord(profile["headers"]);
    const apiKey = await resolveApiKey(deps, profile["apiKeyEnv"]);
    const declared = declaredModelIds(userRoute);
    const probe: RouteProbe = {
      route,
      baseURL,
      api,
      signal,
      fetchImpl: deps.fetchImpl,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(headers === undefined ? {} : { headers }),
    };
    let listed: readonly ListedModel[];
    try {
      listed = await probeRoute(probe);
    } catch (error) {
      failures.push(`${route}: ${message(error)}`);
      continue;
    }
    if (needsManifest(api, listed, declared)) {
      try {
        const manifest = await probeManifest(probe);
        if (manifest !== undefined) listed = mergeListings(listed, manifest);
      } catch (error) {
        failures.push(`${route}: ${message(error)}`);
      }
    }
    for (const model of listed) {
      if (!declared.has(model.id)) continue;
      if (model.efforts !== undefined) {
        intents.push({ route, model: model.id, value: model.efforts });
      }
      const modalities = model.inputModalities;
      if (modalities !== undefined && modalities.includes("image")) {
        intents.push({ field: "input", route, model: model.id, value: modalities });
      }
      const metadata = discoveredMetadata(model);
      intents.push(...metadata.map((intent) => ({ ...intent, route, model: model.id })));
    }
  }
  return { intents, probed, failures };
}

/** One change rendered for an answer. */
function describeChange(change: Change): string {
  const after = change.after;
  const rendered =
    after === undefined
      ? "removed"
      : typeof after === "string" || typeof after === "number"
        ? String(after)
        : change.field === "input"
          ? describeInput(isModelInput(after) ? after : [])
          : describeEfforts(isModelInput(after) ? false : after);
  return `${change.route}/${change.model} ${change.field} -> ${rendered}`;
}

/** A skip rendered for an answer. */
function describeSkip(skip: Skip): string {
  return `skipped ${skip.route}/${skip.model} ${skip.field}: ${skip.reason}`;
}

/**
 * Render one pass's outcome as the command's answer.
 *
 * @param summary - the pass summary.
 * @returns the human-readable lines, one per finding.
 */
export function describeResult(summary: RunSummary): string {
  const { result, namespace } = summary;
  if (result.kind === "unavailable") {
    return `reasoning-efforts: no configurable "${namespace}" entry is mounted, so there is nothing to declare`;
  }
  if (result.kind === "readonly") {
    return "reasoning-efforts: the active profile does not accept configuration edits";
  }
  const unchanged = Math.max(summary.intents - result.changes.length - result.skipped.length, 0);
  const lines: string[] = [];
  if (summary.mode === "status") {
    lines.push(
      `reasoning-efforts: ${String(result.changes.length)} pending change(s) for "${namespace}" (${String(unchanged)} already current)`,
    );
  } else if (result.kind === "unchanged") {
    lines.push(
      `reasoning-efforts: nothing to change in "${namespace}" (${String(unchanged)} already current)`,
    );
  } else {
    lines.push(
      `reasoning-efforts: applied ${String(result.changes.length)} change(s) to "${namespace}" (${String(unchanged)} already current)`,
    );
  }
  for (const change of result.changes.slice(0, MAX_LISTED))
    lines.push(`  ${describeChange(change)}`);
  if (result.changes.length > MAX_LISTED) {
    lines.push(`  … and ${String(result.changes.length - MAX_LISTED)} more`);
  }
  for (const skip of result.skipped.slice(0, MAX_LISTED)) lines.push(`  ${describeSkip(skip)}`);
  if (result.skipped.length > MAX_LISTED) {
    lines.push(`  … and ${String(result.skipped.length - MAX_LISTED)} more skipped`);
  }
  if (summary.mode === "discover" && summary.probed.length === 0) {
    lines.push("  nothing to interrogate: no route declares an explicit models list and a baseURL");
  }
  for (const failure of summary.failures) lines.push(`  discovery failed: ${failure}`);
  return lines.join("\n");
}

/** How many times a load-time pass retries while its namespace is not reachable yet. */
export const LOAD_PASS_ATTEMPTS = 6;

/** Delay between load-time retries, in milliseconds. */
export const LOAD_PASS_RETRY_MS = 100;

/** One load-time pass's outcome: a summary, or the error it rejected with. */
export interface AttemptOutcome {
  readonly summary?: RunSummary;
  readonly error?: unknown;
}

/** How {@link runUntilAvailable} retries, and how it waits. */
export interface RetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run one pass, retrying while the namespace is not reachable.
 *
 * The Loader mounts every entry of a profile concurrently, so a plugin that
 * writes through another entry's configuration can observe that entry before
 * its fiber is active. A profile started by the standard launcher resolves this
 * with its readiness signal; this bounded retry is the fallback for a
 * composition that provides none. It stops at the first pass that is not
 * "unavailable", and it never repeats a pass whose work was already done.
 *
 * @param runtime - the pass to run.
 * @param mode - the mode to run it in.
 * @param options - the attempt budget and the wait between attempts.
 * @returns the last attempt's summary, or the error it rejected with.
 */
export async function runUntilAvailable(
  runtime: Runtime,
  mode: RunMode,
  options: RetryOptions = {},
): Promise<AttemptOutcome> {
  const attempts = Math.max(options.attempts ?? LOAD_PASS_ATTEMPTS, 1);
  const delayMs = options.delayMs ?? LOAD_PASS_RETRY_MS;
  const sleep = options.sleep ?? defaultSleep;
  let last: AttemptOutcome = {};
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const summary = await runtime.run(mode);
      if (summary.result.kind !== "unavailable") return { summary };
      last = { summary };
    } catch (error) {
      last = { error };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return last;
}

/**
 * Build the pass for one resolved row configuration.
 *
 * @param options - the namespace, declarations, and discovery settings.
 * @param deps - the settings, credential, logger, and transport seams.
 * @returns the pass entry point.
 */
export function createRuntime(options: RuntimeOptions, deps: RuntimeDeps): Runtime {
  const run = async (mode: RunMode, signal?: AbortSignal): Promise<RunSummary> => {
    const namespace = options.namespace;
    const seam = deps.settings?.();
    if (seam === undefined) {
      return {
        mode,
        namespace,
        result: { kind: "unavailable", namespace, changes: [], skipped: [] },
        intents: 0,
        probed: [],
        failures: [],
      };
    }
    let intents =
      mode === "clear"
        ? [...removalIntents(options.declarations), ...removalInputIntents(options.inputs)]
        : [...declaredIntents(options.declarations), ...declaredInputIntents(options.inputs)];
    let probed: readonly string[] = [];
    let failures: readonly string[] = [];
    if (mode === "discover") {
      const descriptor = seam.describe().find((entry) => entry.ns === namespace);
      if (descriptor === undefined) {
        return {
          mode,
          namespace,
          result: { kind: "unavailable", namespace, changes: [], skipped: [] },
          intents: 0,
          probed,
          failures,
        };
      }
      const discovery = await discoverIntents(deps, options, descriptor, signal);
      intents = mergeIntents(intents, discovery.intents);
      probed = discovery.probed;
      failures = discovery.failures;
    }
    const result = await applyIntents(seam, {
      namespace,
      intents,
      dryRun: mode === "status",
    });
    return { mode, namespace, result, intents: intents.length, probed, failures };
  };
  return { run };
}
