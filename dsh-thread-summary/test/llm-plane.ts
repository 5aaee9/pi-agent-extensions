/**
 * The real pinned LLM plane: `LlmRuntime` plus the real `@deepseek-ai/dsh-llm-pi-ai`
 * adapter, whose `providers` section routes `local/summary-model` to a locally
 * started OpenAI-compatible server (`model-server.ts`). The route's credential
 * reference resolves through the adapter's own launch-environment fallback, so
 * the key travels as a real bearer header. The `llm/stream` waterfall listener
 * only records the request and delegates to the real dispatch.
 */
import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import * as PiAi from "@deepseek-ai/dsh-llm-pi-ai";
import { onTestFinished, vi } from "vitest";
import {
  localProviders,
  MODEL_API_KEY,
  MODEL_API_KEY_ENV,
  startModelServer,
} from "./model-server.ts";
import type { ModelServer } from "./model-server.ts";

/** The package's own `model` setting that selects the local route. */
export const LOCAL_MODEL = "local/summary-model";

export interface LlmPlane {
  readonly ctx: Context;
  readonly server: ModelServer;
  readonly calls: GenerateOptions[];
}

/** Mount `LlmRuntime` and the real pi-ai adapter into `ctx` against a local endpoint. */
export async function mountLlmPlane(ctx: Context): Promise<LlmPlane> {
  vi.stubEnv(MODEL_API_KEY_ENV, MODEL_API_KEY);
  const server = await startModelServer();
  onTestFinished(() => server.close());
  await ctx.plugin(LlmRuntime).await();
  await ctx.plugin(PiAi, { providers: localProviders(server.baseURL) }).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  return { ctx, server, calls };
}

/** A fresh root context carrying only the LLM plane. */
export async function createLlmPlane(): Promise<LlmPlane> {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  return mountLlmPlane(ctx);
}
