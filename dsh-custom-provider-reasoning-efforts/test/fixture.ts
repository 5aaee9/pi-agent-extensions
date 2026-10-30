/**
 * The real host plane and the deployment data the converted tests drive.
 *
 * Every test boots a real dsh profile from an isolated temporary `$DSH_HOME`:
 * the pinned Loader mounts the pinned `@deepseek-ai/dsh-config-editor`,
 * `@deepseek-ai/dsh-settings`, and `@deepseek-ai/dsh-commands` packages, plus
 * this package's real `index.ts` row. Writes therefore go through
 * `SettingsForms.update()` and land in the profile's own
 * `cordis.patch.yml`, and every assertion can re-read the live descriptor or
 * the file on disk.
 *
 * The profile data below is deployment configuration, not a host stand-in: the
 * `magpie` and Codex shapes are the routes, models, and gateway listings the
 * plugin was written for.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Context } from "@deepseek-ai/cordis";
import { boot, readProfilePatches, type ProfileContext } from "@deepseek-ai/dsh-app-boot";
import type {
  CommandDefinition,
  CommandInvocation,
  CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { onTestFinished } from "vitest";

import type { ProviderDescriptor, SettingsSeam } from "../apply.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** The profile entry id the plugin defaults to. */
export const NAMESPACE = "llm-pi-ai";

/** The `llm-pi-ai` layer this plugin exists for: a catalog route and a hand-written one. */
export function magpieProfile(): Record<string, unknown> {
  return {
    providers: {
      "opencode-go": { apiKeyEnv: "OPENCODE_GO_API_KEY" },
      magpie: {
        displayName: "Magpie",
        apiKeyEnv: "MAGPIE_API_KEY",
        api: "openai-responses",
        baseURL: "https://magpie.indexyz.me/v1",
        models: [
          {
            id: "ollama-cloud/kimi-k3",
            name: "Kimi K3",
            contextWindow: 1048576,
            maxTokens: 131072,
            input: ["text"],
          },
          {
            id: "ollama-cloud/deepseek-v4.1-flash",
            name: "DeepSeek V4.1 Flash",
            contextWindow: 1048576,
            maxTokens: 384000,
          },
        ],
      },
    },
  };
}

/** The providers table of {@link magpieProfile}. */
export function magpieProviders(): Record<string, unknown> {
  const providers = magpieProfile()["providers"];
  if (!isRecord(providers)) throw new Error("the fixture profile carries no providers table");
  return providers;
}

/** The listing this deployment's gateway answers with, as reported in the defect. */
export function magpieListing(): unknown {
  return {
    data: [
      {
        id: "ollama-cloud/kimi-k3",
        name: "Kimi K3",
        contextWindow: 1048576,
        maxTokens: 131072,
        reasoning: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
      },
      {
        id: "ollama-cloud/deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        contextWindow: 1048576,
        maxTokens: 384000,
        reasoning: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
      },
      {
        id: "ollama-cloud/glm-5.3",
        name: "Ollama GLM-5.3",
        reasoning: true,
        supported_reasoning_levels: [{ effort: "high" }],
      },
    ],
  };
}

/** A listing an OpenRouter-shaped gateway answers with, publishing request modalities. */
export function visionListing(): unknown {
  return {
    data: [
      { id: "ollama-cloud/kimi-k3", architecture: { input_modalities: ["text", "image"] } },
      { id: "ollama-cloud/deepseek-v4.1-flash", architecture: { input_modalities: ["text"] } },
      { id: "ollama-cloud/glm-5.3", architecture: { input_modalities: ["text", "image"] } },
    ],
  };
}

/** A Codex-shaped relay route: an explicit model list whose inventory publishes no reasoning. */
export function codexProfile(): Record<string, unknown> {
  return {
    providers: {
      "zero-aicoding-codex": {
        displayName: "Zero AI Coding Codex",
        apiKeyEnv: "ZERO_AICODING_CODEX_API_KEY",
        api: "openai-responses",
        baseURL: "https://aicoding.api.zeroclover.io/v1",
        models: [
          { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", contextWindow: 256000 },
          { id: "gpt-6-luna", name: "GPT-6-Luna", contextWindow: 256000 },
          { id: "codex-auto-review", name: "Codex Auto Review", contextWindow: 256000 },
        ],
      },
    },
  };
}

/** The providers table of {@link codexProfile}. */
export function codexProviders(): Record<string, unknown> {
  const providers = codexProfile()["providers"];
  if (!isRecord(providers)) throw new Error("the fixture profile carries no providers table");
  return providers;
}

/** The inventory that route answers: ids only, no reasoning capability. */
export function codexInventory(): unknown {
  return {
    data: [
      { id: "gpt-6.1-sol", object: "model", owned_by: "openai", display_name: "GPT-6.1-Sol" },
      { id: "gpt-6-luna", object: "model", owned_by: "openai", display_name: "GPT-6-Luna" },
      { id: "codex-auto-review", object: "model", owned_by: "openai" },
    ],
  };
}

/** The Codex manifest that route answers, carrying the efforts the backend accepts. */
export function codexManifest(): unknown {
  return {
    models: [
      {
        slug: "gpt-6.1-sol",
        display_name: "GPT-6.1-Sol",
        context_window: 500000,
        supported_reasoning_levels: [
          { effort: "low", description: "Fast responses with lighter reasoning" },
          { effort: "medium", description: "Balances speed and reasoning depth" },
          { effort: "high", description: "Greater reasoning depth" },
          { effort: "xhigh", description: "Extra high reasoning depth" },
          { effort: "max", description: "Maximum reasoning depth" },
          { effort: "ultra", description: "Maximum reasoning with delegation" },
        ],
      },
      {
        slug: "gpt-6-luna",
        display_name: "GPT-6-Luna",
        context_window: 272000,
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
          { effort: "max" },
        ],
      },
    ],
  };
}

/** One real HTTP reply served in-process. */
export interface HttpReply {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** One request a real in-process server received. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** A real local HTTP server the package's real `fetch` calls. */
export interface TestServer {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * Start a real `node:http` server in-process.
 *
 * @param replies - replies keyed by the exact request path (query included); an
 *   unlisted path answers 404.
 * @returns the server, its origin, and the requests it received.
 */
export async function startServer(
  replies: Readonly<Record<string, HttpReply>>,
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    requests.push({ url, method: request.method ?? "GET", headers: request.headers });
    const reply = replies[url];
    if (reply === undefined) {
      response.writeHead(404, { "content-type": "text/plain", connection: "close" });
      response.end("not found");
      return;
    }
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    response.writeHead(reply.status ?? 200, {
      "content-type": "application/json",
      connection: "close",
      ...reply.headers,
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${String(address.port)}`;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error !== undefined) reject(error);
        else resolve();
      });
    });
    return closing;
  };
  onTestFinished(close);
  return { url, requests, close };
}

/** Options for {@link createHost}. */
export interface HostOptions {
  /** The deployment's `providers` table; defaults to {@link magpieProviders}. */
  readonly providers?: Record<string, unknown>;
  /** The plugin row's own configuration; defaults to `applyOnLoad: false`. */
  readonly config?: Record<string, unknown>;
  /** The configurable row id the deployment (and the plugin) addresses. */
  readonly namespace?: string;
  /** Use the row whose schema refuses every `providers` entry. */
  readonly rejectWrites?: boolean;
  /** Mount the settings service; `false` leaves the command usable without it. */
  readonly settings?: boolean;
  /** Provide the launcher's readiness signal on the real context. */
  readonly appReady?: boolean;
}

/** The live host one test drives. */
export interface Host {
  readonly ctx: Context;
  readonly patchPath: string;
  readonly profileContext: ProfileContext;
  readonly definition: CommandDefinition;
  /** Structured lines the real Cordis logger exported. */
  readonly logs: readonly string[];
  /** Run the real command registration with one argument. */
  run(rawInput: string): Promise<CommandResult>;
  /** The target namespace's live `user` provider table. */
  providers(): Record<string, unknown> | undefined;
  /** The target namespace's live descriptor. */
  descriptor(): SettingsDescriptor | undefined;
  /** The profile patch as it stands on disk. */
  readPatch(): Promise<string>;
  /** Fire the launcher readiness listeners, as `dsh` does after boot. */
  triggerReady(): void;
  /** How many readiness listeners the plugin has registered so far. */
  readyPending(): number;
}

interface ReadyGate {
  readonly service: {
    onReady(listener: () => void): () => void;
  };
  trigger(): void;
  pending(): number;
}

function createReadyGate(): ReadyGate {
  const listeners = new Set<() => void>();
  return {
    service: {
      onReady: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    trigger: () => {
      for (const listener of listeners) listener();
      listeners.clear();
    },
    pending: () => listeners.size,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function moduleEntry(name: string): string {
  return pathToFileURL(join(packageRoot, "node_modules", "@deepseek-ai", name, "lib", "index.js"))
    .href;
}

function sourceEntry(relativePath: string): string {
  return pathToFileURL(join(packageRoot, relativePath)).href;
}

/** A real command invocation carrying only what this plugin's handler reads. */
export function invocation(rawInput: string): CommandInvocation {
  return { rawInput, signal: new AbortController().signal } as CommandInvocation;
}

/**
 * Boot a real isolated dsh profile for one test.
 *
 * @param options - the deployment's rows, the plugin row's config, and the
 *   optional settings/readiness services.
 * @returns the booted context, the real command registration, and helpers that
 *   read the live descriptor, the persisted profile patch, and the real logs.
 */
export async function createHost(options: HostOptions = {}): Promise<Host> {
  const namespace = options.namespace ?? NAMESPACE;
  const providers = options.providers ?? magpieProviders();
  const config = options.config ?? { applyOnLoad: false };
  const withSettings = options.settings !== false;
  const ready = options.appReady === true ? createReadyGate() : undefined;

  const root = await mkdtemp(join(tmpdir(), "custom-provider-reasoning-efforts-"));
  const home = resolveDshHome(join(root, "home"));
  const profileDir = join(home, "profiles", "test-profile");
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    join(profileDir, "package.json"),
    `${JSON.stringify(
      { name: "test-profile", private: true, dsh: { profile: { bundles: [] } } },
      undefined,
      2,
    )}\n`,
  );
  await writeFile(join(profileDir, "cordis.yml"), "[]\n");

  const row = sourceEntry(
    options.rejectWrites === true ? "test/rejecting-provider-row.ts" : "test/provider-row.ts",
  );
  const inserted: unknown[] = [
    {
      id: "commands",
      name: moduleEntry("dsh-commands"),
    },
  ];
  if (withSettings) {
    inserted.unshift(
      {
        id: "config-editor",
        name: moduleEntry("dsh-config-editor"),
      },
      {
        id: "settings",
        name: moduleEntry("dsh-settings"),
      },
    );
    inserted.push({
      id: namespace,
      name: row,
      config: {},
    });
  }
  inserted.push({
    id: "custom-provider-reasoning-efforts",
    name: sourceEntry("index.ts"),
    config,
  });
  const patches: unknown[] = [{ insert: inserted }];
  if (withSettings) {
    patches.push({
      id: namespace,
      name: row,
      config: { providers },
    });
  }
  const patchPath = join(profileDir, "cordis.patch.yml");
  await writeFile(patchPath, `${JSON.stringify(patches, undefined, 2)}\n`);

  const profileContext: ProfileContext = {
    name: "test-profile",
    dir: profileDir,
    patchPath,
    installAnchor: join(packageRoot, "package.json"),
    startedBundles: [],
    cwd: process.cwd(),
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  };

  const logs: string[] = [];
  let ctx: Context | undefined;
  onTestFinished(async () => {
    await ctx?.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });

  ctx = await boot(
    "test-profile",
    join(profileDir, "cordis.yml"),
    readProfilePatches("test-profile", profileContext),
    (hostCtx) => {
      hostCtx.provide("profileContext", profileContext);
      if (ready !== undefined) hostCtx.provide("appReady", ready.service);
      hostCtx.logger.exporter({
        levels: { default: 3 },
        export: (message) => {
          logs.push(
            `${message.type} ${message.args.map((value: unknown) => String(value)).join(" ")}`,
          );
        },
      });
    },
  );

  const agentKey = {} as CommandInvocation["agent"];
  const definition = ctx.commands.find(agentKey, "reasoning-efforts");
  if (definition === undefined)
    throw new Error("the real commands service has no /reasoning-efforts");

  const descriptor = (): SettingsDescriptor | undefined => {
    if (!withSettings) return undefined;
    return ctx?.settings.describe().find((entry) => entry.ns === namespace);
  };
  const providersOf = (): Record<string, unknown> | undefined => {
    const user = descriptor()?.user;
    if (!isRecord(user)) return undefined;
    const table = user["providers"];
    return isRecord(table) ? table : undefined;
  };

  return {
    ctx,
    patchPath,
    profileContext,
    definition,
    logs,
    run: (rawInput) =>
      Promise.resolve(
        definition.handler({ rawInput, signal: new AbortController().signal } as CommandInvocation),
      ),
    providers: providersOf,
    descriptor,
    readPatch: () => readFile(patchPath, "utf8"),
    triggerReady: () => {
      ready?.trigger();
    },
    readyPending: () => ready?.pending() ?? 0,
  };
}

/**
 * The model entries of one route in a providers table.
 *
 * @param providers - the deployment table.
 * @param route - the route key to read.
 * @returns that route's model entries, in declaration order.
 */
export function routeModels(
  providers: Record<string, unknown> | undefined,
  route: string,
): Array<Record<string, unknown>> {
  const entry = providers?.[route];
  if (!isRecord(entry)) throw new Error(`the profile does not declare route "${route}"`);
  const models = entry["models"];
  if (!Array.isArray(models)) throw new Error(`route "${route}" declares no models list`);
  return models.filter(isRecord);
}

/**
 * Set one real process environment variable for the duration of the test.
 *
 * The plugin reads a route's `apiKeyEnv` through the process environment when
 * no credentials service is mounted, so this is the real resolution path.
 *
 * @param name - the variable name.
 * @param value - the value to expose, or `undefined` to remove it.
 */
export function setEnvironment(name: string, value: string | undefined): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  onTestFinished(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

/**
 * Copy a providers table and replace one route's fields.
 *
 * @param providers - the deployment table to copy.
 * @param route - the route key to patch.
 * @param patch - fields to merge into that route.
 * @returns a detached providers table.
 */
export function routeProviders(
  providers: Record<string, unknown>,
  route: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const copy = structuredClone(providers);
  const current = copy[route];
  copy[route] = { ...(isRecord(current) ? current : {}), ...patch };
  return copy;
}

/**
 * The real settings service as the seam the writer consumes.
 *
 * @param ctx - a context whose pinned settings service is mounted.
 * @returns a seam that delegates every read and write to that service.
 */
export function settingsSeam(ctx: Context): SettingsSeam {
  return {
    get writable() {
      return ctx.settings.writable;
    },
    describe: (): readonly ProviderDescriptor[] => ctx.settings.describe(),
    update: async (ns, patch, expectedRevision) => {
      await ctx.settings.update(ns, patch, expectedRevision);
    },
  };
}

/**
 * A seam over the real settings service whose first write loses a real revision race.
 *
 * It persists `competitor` through the same service a Models-page save uses, so
 * the plugin's own guarded write receives the real `SettingsConflictError` and
 * its retry reads the fresh revision.
 *
 * @param ctx - a context whose pinned settings service is mounted.
 * @param competitor - the providers table the competing save persists.
 * @returns the seam, delegating every operation to the real service.
 */
export function conflictingSeam(ctx: Context, competitor: Record<string, unknown>): SettingsSeam {
  const seam = settingsSeam(ctx);
  let raced = false;
  return {
    get writable() {
      return seam.writable;
    },
    describe: () => seam.describe(),
    update: async (ns, patch, expectedRevision) => {
      if (!raced) {
        raced = true;
        await ctx.settings.update(ns, { providers: competitor });
      }
      await seam.update(ns, patch, expectedRevision);
    },
  };
}

/** Read one value from a descriptor's `user` layer. */
export function userValue(descriptor: SettingsDescriptor | undefined, key: string): unknown {
  const user = descriptor?.user;
  return isRecord(user) ? user[key] : undefined;
}

/** Read a model entry's field from a providers table read out of the profile. */
export function modelField(
  providers: Record<string, unknown> | undefined,
  route: string,
  model: string,
  field: string,
): unknown {
  const entry = providers?.[route];
  if (!isRecord(entry)) return undefined;
  const models = entry["models"];
  if (!Array.isArray(models)) return undefined;
  for (const candidate of models) {
    if (isRecord(candidate) && candidate["id"] === model) return candidate[field];
  }
  return undefined;
}
