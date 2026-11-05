// A child session that shares its parent's ModelRuntime must not take the
// parent's relay with it on shutdown, and /reload must still drop a relay the
// replacement configuration no longer registers.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeAll, afterAll, expect, it } from "vitest";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const CLAIMS = Symbol.for("@indexyz/pi-provider-sub2api/provider-claims");

interface RelayServer {
  readonly baseUrl: string;
  readonly completions: () => number;
  close(): Promise<void>;
}

const sessions: AgentSession[] = [];
let server: RelayServer;
let agentDir: string;
let projectDir: string;
let previousAgentDir: string | undefined;
let previousOffline: string | undefined;

function chatStream(): string {
  const chunk = (delta: unknown, finish: string | null, usage?: unknown): string =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "gpt-test",
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage === undefined ? {} : { usage }),
    })}\n\n`;
  return [
    chunk({ role: "assistant", content: "pong" }, null),
    chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    "data: [DONE]\n\n",
  ].join("");
}

async function startRelay(): Promise<RelayServer> {
  let completions = 0;
  const http = createServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "";
    if (request.method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-test", name: "GPT Test" }] }));
      return;
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      completions += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(chatStream());
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  const address = http.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    completions: () => completions,
    close: () => closeServer(http),
  };
}

function closeServer(http: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    http.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function writeConfig(providers: readonly string[]): Promise<void> {
  const entries = Object.fromEntries(
    providers.map((provider) => [
      provider,
      { baseURL: server.baseUrl, token: "test-token", api: "openai-completions" },
    ]),
  );
  await writeFile(join(agentDir, "sub2api.json"), `${JSON.stringify(entries)}\n`);
}

async function openSession(runtime: ModelRuntime): Promise<AgentSession> {
  const loader = new DefaultResourceLoader({
    cwd: projectDir,
    agentDir,
    additionalExtensionPaths: [extensionPath],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  const failure = loaded.errors[0];
  if (failure) throw new Error(`extension failed to load: ${failure.error}`);
  const { session } = await createAgentSession({
    cwd: projectDir,
    agentDir,
    modelRuntime: runtime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(projectDir),
    noTools: "all",
  });
  sessions.push(session);
  return session;
}

async function createRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    refreshOnCreate: false,
  });
}

function modelOf(runtime: ModelRuntime, provider: string): Model<Api> {
  const model = runtime.getModel(provider, "gpt-test");
  if (!model) throw new Error(`${provider}/gpt-test is not registered`);
  if (model.api !== "openai-completions") {
    throw new Error(`${provider}/gpt-test registered as ${model.api}`);
  }
  return model;
}

async function request(runtime: ModelRuntime, model: Model<Api>): Promise<AssistantMessage> {
  return runtime.complete(model, {
    messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
  });
}

beforeAll(async () => {
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  previousOffline = process.env.PI_OFFLINE;
  delete process.env.PI_OFFLINE;
  server = await startRelay();
  agentDir = await mkdtemp(join(tmpdir(), "sub2api-agent-"));
  projectDir = await mkdtemp(join(tmpdir(), "sub2api-project-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await writeFile(join(agentDir, "models.json"), '{"providers":{}}\n');
});

afterAll(async () => {
  await server.close();
  await rm(agentDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
});

afterEach(async () => {
  const open = sessions.splice(0);
  const failures: unknown[] = [];
  for (const session of open) {
    try {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  // Ownership lives on globalThis for the life of the process. Drop it so a
  // failed test cannot keep a relay alive for the next one.
  delete (globalThis as { [CLAIMS]?: unknown })[CLAIMS];
  if (failures.length > 0) throw new AggregateError(failures, "session cleanup failed");
});

it("keeps the parent's relay after a child session on the shared runtime shuts down", async () => {
  await writeConfig(["sub2api"]);
  const runtime = await createRuntime();
  const parent = await openSession(runtime);
  const selected = modelOf(runtime, "sub2api");
  await parent.bindExtensions({});
  await parent.setModel(selected);

  await writeConfig(["sub2api", "extra"]);
  const child = await openSession(runtime);
  const extra = modelOf(runtime, "extra");
  await child.bindExtensions({});
  expect(runtime.getModel("sub2api", "gpt-test")).toBeDefined();

  await child.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });

  expect(runtime.getModel("sub2api", "gpt-test")?.provider).toBe("sub2api");
  expect(runtime.getModel("extra", "gpt-test")).toBeUndefined();
  const before = server.completions();
  const parentResult = await request(runtime, parent.model ?? selected);
  expect(parentResult.stopReason).toBe("stop");
  expect(parentResult.errorMessage).toBeUndefined();
  expect(parentResult.content).toContainEqual({ type: "text", text: "pong" });
  expect(server.completions()).toBe(before + 1);

  const childOnly = await request(runtime, extra);
  expect(childOnly).toMatchObject({
    stopReason: "error",
    errorMessage: "Unknown provider: extra",
  });
  expect(server.completions()).toBe(before + 1);
});

it("drops a relay removed from the configuration when the session reloads", async () => {
  await writeConfig(["keep", "drop"]);
  const runtime = await createRuntime();
  const session = await openSession(runtime);
  const drop = modelOf(runtime, "drop");
  const keep = modelOf(runtime, "keep");
  await session.setModel(keep);

  await writeConfig(["keep"]);
  await session.reload();

  expect(runtime.getModel("drop", "gpt-test")).toBeUndefined();
  expect(runtime.getModel("keep", "gpt-test")).toBeDefined();
  const before = server.completions();
  const removed = await request(runtime, drop);
  expect(removed).toMatchObject({
    stopReason: "error",
    errorMessage: "Unknown provider: drop",
  });
  expect(server.completions()).toBe(before);
  const kept = await request(runtime, keep);
  expect(kept.stopReason).toBe("stop");
  expect(kept.errorMessage).toBeUndefined();
  expect(server.completions()).toBe(before + 1);
});

it("reloads one runtime without dropping a relay another runtime still holds", async () => {
  await writeConfig(["keep", "drop"]);
  const runtimeA = await createRuntime();
  const runtimeB = await createRuntime();
  const sessionA = await openSession(runtimeA);
  const sessionB = await openSession(runtimeB);
  await sessionA.bindExtensions({});
  await sessionB.bindExtensions({});
  const dropOnA = modelOf(runtimeA, "drop");
  const dropOnB = modelOf(runtimeB, "drop");
  const keepOnB = modelOf(runtimeB, "keep");

  await writeConfig(["keep"]);
  await sessionB.reload();

  expect(runtimeB.getModel("drop", "gpt-test")).toBeUndefined();
  expect(runtimeA.getModel("drop", "gpt-test")?.provider).toBe("drop");
  const before = server.completions();
  const removed = await request(runtimeB, dropOnB);
  expect(removed).toMatchObject({
    stopReason: "error",
    errorMessage: "Unknown provider: drop",
  });
  const stillThere = await request(runtimeA, dropOnA);
  expect(stillThere.stopReason).toBe("stop");
  expect(stillThere.errorMessage).toBeUndefined();
  const kept = await request(runtimeB, keepOnB);
  expect(kept.stopReason).toBe("stop");
  expect(server.completions()).toBe(before + 2);
});
