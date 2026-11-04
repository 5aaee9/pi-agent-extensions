// `/model-trace` installed from its tarball: it reads the data bank it shipped
// with, probes through the real child processes, and answers every command form.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { isRecord } from "../../release/json.ts";
import type { RpcClient, RpcEvent } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf, messagesOf } from "./servers.ts";
import type { ChatReply, ChatScript, LocalServer, RecordedRequest } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const PACKAGES = { packages: ["pi-model-trace"] };
const NUMBERS = Array.from({ length: 300 }, (_, index) => String(((index * 17) % 355) + 1)).join(
  ", ",
);
const ANSWER: ChatReply = { text: NUMBERS };
const ATTRIBUTED = "归因结果";
const ALL_PROBES_VALID = "有效回答 3/3";
const HOLD_MS = 300;

const model = (id: string): Readonly<Record<string, unknown>> => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 1_000_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/** `probe/m` is selected; `other/solo` has a unique id; `shared` exists on both providers. */
function modelsFor(baseUrl: string): unknown {
  const provider = (models: readonly string[]): unknown => ({
    baseUrl: `${baseUrl}/v1`,
    api: "openai-completions",
    apiKey: "local",
    models: models.map((id) => model(id)),
  });
  return {
    providers: { probe: provider(["m", "shared"]), other: provider(["solo", "shared"]) },
  };
}

async function serveModels(
  { world, chatServer }: Readonly<Pick<Scenario, "world" | "chatServer">>,
  script: ChatScript = () => ANSWER,
): Promise<LocalServer> {
  const server = await chatServer(script);
  world.writeAgentFile("models.json", modelsFor(server.baseUrl));
  return server;
}

const isOutcome = (event: Readonly<RpcEvent>): boolean =>
  event["type"] === "extension_ui_request" &&
  event["method"] === "notify" &&
  /^ModelTrace (?:finished|failed)/u.test(String(event["message"]));

/** The report the transcript holds after a run's outcome; a failed run throws its message. */
async function reportAfter(client: RpcClient, outcome: Readonly<RpcEvent>): Promise<string> {
  const message = String(outcome["message"]);
  assert.ok(message.startsWith("ModelTrace finished"), message);
  const response = await client.send({ type: "get_messages" });
  const data = response["data"];
  const messages: unknown = isRecord(data) ? data["messages"] : undefined;
  const reports = (Array.isArray(messages) ? messages : []).filter(
    (entry: unknown) => isRecord(entry) && entry["customType"] === "model-trace",
  );
  const report: unknown = reports.at(-1);
  assert.ok(isRecord(report) && typeof report["content"] === "string", "no report in transcript");
  return report["content"];
}

async function trace(client: RpcClient, command: string): Promise<string> {
  const outcome = client.next(isOutcome, `the outcome of ${command}`);
  const accepted = client.send({ type: "prompt", message: command });
  const report = await reportAfter(client, await outcome);
  await accepted;
  return report;
}

const modelsSent = (requests: readonly RecordedRequest[]): readonly string[] =>
  requests.map((request) => String(bodyOf(request)["model"]));

const promptsSent = (requests: readonly RecordedRequest[]): readonly string[] =>
  requests.map(
    (request) => messagesOf(request).findLast((message) => message.role === "user")?.text ?? "",
  );

scenario(
  "bare /model-trace probes the selected model three times and reports from the shipped bank",
  PACKAGES,
  async (context) => {
    const server = await serveModels(context);
    const client = context.rpc(["--no-session", ...PROBE_ARGS]);
    const report = await trace(client, "/model-trace");
    assert.ok(report.includes("`probe/m`"), report);
    assert.ok(report.includes(ATTRIBUTED), report);
    assert.ok(report.includes(ALL_PROBES_VALID), report);
    assert.deepEqual(modelsSent(server.requests), ["m", "m", "m"]);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "/model-trace takes a unique bare id or a provider-qualified id",
  PACKAGES,
  async (context) => {
    const server = await serveModels(context);
    const client = context.rpc(["--no-session", ...PROBE_ARGS]);
    const bareId = await trace(client, "/model-trace solo");
    assert.ok(bareId.includes("`other/solo`"), bareId);
    assert.deepEqual(modelsSent(server.requests), ["solo", "solo", "solo"]);
    const qualified = await trace(client, "/model-trace other/shared");
    assert.ok(qualified.includes("`other/shared`"), qualified);
    assert.deepEqual(modelsSent(server.requests.slice(3)), ["shared", "shared", "shared"]);
  },
);

scenario("an ambiguous or unknown id is an error and sends no probe", PACKAGES, async (context) => {
  const server = await serveModels(context);
  const client = context.rpc(["--no-session", ...PROBE_ARGS]);
  await client.send({ type: "prompt", message: "/model-trace shared" });
  await client.send({ type: "prompt", message: "/model-trace nope" });
  assert.deepEqual(client.notifications(), [
    { message: 'Ambiguous model "shared": probe/shared, other/shared', type: "error" },
    { message: 'Unknown model "nope". Usage: /model-trace [provider/model]', type: "error" },
  ]);
  assert.equal(server.requests.length, 0);
});

scenario(
  "a probe whose process failed is retried once and still counts",
  PACKAGES,
  async (context) => {
    let failed = false;
    const server = await serveModels(context, (): ChatReply => {
      if (failed) return ANSWER;
      failed = true;
      return { failure: { status: 400, message: "bad request" } };
    });
    const client = context.rpc(["--no-session", ...PROBE_ARGS]);
    const report = await trace(client, "/model-trace");
    assert.ok(report.includes(ALL_PROBES_VALID), report);
    const prompts = promptsSent(server.requests);
    assert.equal(prompts.length, 4);
    assert.equal(new Set(prompts).size, 3, "only the failed challenge is sent again");
    assert.ok(
      client.notifications().some((notice) => notice.message.includes("retrying")),
      JSON.stringify(client.notifications()),
    );
  },
);

scenario(
  "/model-trace during a held turn waits for it before probing",
  PACKAGES,
  async (context) => {
    const inFlight = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let first = true;
    const server = await serveModels(context, (): ChatReply => {
      if (!first) return ANSWER;
      first = false;
      inFlight.resolve();
      return {
        text: "turn reply",
        gate: async (): Promise<void> => {
          await release.promise;
        },
      };
    });
    const client = context.rpc(["--no-session", ...PROBE_ARGS]);
    await client.send({ type: "prompt", message: "hello" });
    await inFlight.promise;
    const outcome = client.next(isOutcome, "the outcome of /model-trace");
    const accepted = client.send({ type: "prompt", message: "/model-trace" });
    await delay(HOLD_MS);
    assert.deepEqual(client.notifications(), [], "no probe may start while the turn is running");
    assert.equal(server.requests.length, 1);
    release.resolve();
    const report = await reportAfter(client, await outcome);
    await accepted;
    assert.ok(report.includes(ALL_PROBES_VALID), report);
    assert.equal(server.requests.length, 4);
  },
);
