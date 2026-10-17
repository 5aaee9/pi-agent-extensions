/**
 * Fakes shaped like the Harness pieces `@indexyz/dsh-custom-provider-reasoning-efforts`
 * depends on: the settings service's descriptor, the credentials service, and a
 * Host context that records command registrations and injections.
 *
 * The provider fixture is the deployment shape this plugin exists for: an
 * `llm-pi-ai` patch layer whose hand-written `magpie` route declares an explicit
 * model list, a `baseURL`, and no `reasoningEfforts` — and a catalog route
 * beside it that carries neither.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { CommandDefinition } from "@deepseek-ai/dsh-commands";

import type { SettingsSeam } from "../apply.ts";

/** One recorded `settings.update()` call. */
export interface SettingsCall {
  readonly ns: string;
  readonly patch: Record<string, unknown>;
  readonly revision: number | undefined;
}

/** A settings seam that keeps the profile layer it is given. */
export interface FakeSettings {
  readonly seam: SettingsSeam;
  readonly calls: SettingsCall[];
  readonly state: {
    user: Record<string, unknown>;
    revision: number;
    /** Remaining writes that reject with a revision conflict before succeeding. */
    conflicts: number;
    writes: number;
  };
}

/**
 * Build a settings seam over one profile layer.
 *
 * @param user - the entry's raw config (its `providers` table is what a write replaces).
 * @param revision - the revision `describe()` reports first.
 * @returns the seam, its recorded calls, and its mutable state.
 */
export function fakeSettings(user: Record<string, unknown>, revision = 3): FakeSettings {
  const state = {
    user,
    revision,
    conflicts: 0,
    writes: 0,
  };
  const calls: SettingsCall[] = [];
  const seam: SettingsSeam = {
    writable: true,
    describe: () => [
      {
        ns: "llm-pi-ai",
        revision: state.revision,
        value: state.user,
        user: state.user,
      },
    ],
    update: async (ns, patch, expectedRevision) => {
      calls.push({ ns, patch: patch as Record<string, unknown>, revision: expectedRevision });
      if (state.conflicts > 0) {
        state.conflicts -= 1;
        state.revision += 1;
        const conflict = new Error("namespace changed since it was read") as Error & {
          code: string;
        };
        conflict.name = "SettingsConflictError";
        conflict.code = "SETTINGS_CONFLICT";
        throw conflict;
      }
      state.writes += 1;
      state.user = {
        ...state.user,
        providers: (patch as { providers?: unknown }).providers,
      };
      state.revision += 1;
    },
  };
  return { seam, calls, state };
}

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

/** Options for {@link createHarness}. */
export interface HarnessOptions {
  readonly settings?: SettingsSeam;
  readonly credentials?: { resolve(ref: string): Promise<{ readonly value: string } | undefined> };
  /** Provide the launcher's readiness signal on `ctx`. */
  readonly appReady?: boolean;
}

/** A Host context that records what the plugin registers. */
export interface Harness {
  readonly ctx: Context;
  readonly definitions: CommandDefinition[];
  readonly logs: string[];
  /** Invoke every recorded `ctx.inject()` callback, as the Loader would once the service arrives. */
  injectAll(): void;
  /** Fire the readiness listeners registered through `ctx.appReady`. */
  triggerReady(): void;
}

/**
 * Build a Host context stand-in for the plugin's `apply`.
 *
 * @param options - the seams the plugin resolves through `ctx.get`.
 * @returns the context and the recorded registrations.
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const definitions: CommandDefinition[] = [];
  const logs: string[] = [];
  const pending: Array<() => void> = [];
  const readyListeners: Array<() => void> = [];
  const ctx = {
    logger: {
      debug: (line: string) => logs.push(`debug ${line}`),
      info: (line: string) => logs.push(`info ${line}`),
      warn: (line: string) => logs.push(`warn ${line}`),
      error: (line: string) => logs.push(`error ${line}`),
    },
    effect: (execute: () => unknown) => {
      const dispose: unknown = execute();
      return typeof dispose === "function" ? dispose : () => {};
    },
    get: (service: string) => {
      if (service === "settings") return options.settings;
      if (service === "credentials") return options.credentials;
      if (service === "appReady" && options.appReady === true) {
        return {
          onReady: (listener: () => void) => {
            readyListeners.push(listener);
            return () => {};
          },
        };
      }
      return undefined;
    },
    inject: (_names: string[], callback: (child: Context) => void) => {
      pending.push(() => {
        callback(ctx as unknown as Context);
      });
      return () => {};
    },
    commands: {
      register: (definition: CommandDefinition) => {
        definitions.push(definition);
        return () => {};
      },
    },
  };
  return {
    ctx: ctx as unknown as Context,
    definitions,
    logs,
    injectAll: () => {
      for (const run of pending.splice(0)) run();
    },
    triggerReady: () => {
      for (const run of readyListeners.splice(0)) run();
    },
  };
}

/** Let queued promise continuations run. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
