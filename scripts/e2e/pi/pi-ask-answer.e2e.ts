// `/answer` from the outside: extraction picks a model that can really answer,
// the form opens on what the model extracted, and the answer reaches the chat.
import assert from "node:assert/strict";
import { join } from "node:path";

import { FINISHED, PACKAGES, askCall, sentText, submitFirstOption } from "./pi-ask-support.ts";
import type { Terminal } from "./pty.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { ChatScript, LocalServer, RecordedRequest } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";
import type { EnvExtra } from "./world.ts";

const ASSISTANT_QUESTION = "ASSISTANT_ASKS: red or blue?";
const USER_TURN = "USER_OPENS_THE_CHAT";
const EXTRACTED = "EXTRACTED_PROMPT";
const EXTRACTED_FORM = {
  questions: [
    {
      id: "color",
      label: "Color",
      prompt: `${EXTRACTED}: Which color?`,
      options: [
        { value: "red", label: "Red" },
        { value: "blue", label: "Blue" },
      ],
    },
  ],
};
// The default `answer.extractionModels` resolve from these, so a developer's own
// credentials would change which model answers.
const NO_DEFAULT_CREDENTIALS: EnvExtra = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_OAUTH_TOKEN: "",
  COPILOT_GITHUB_TOKEN: "",
};

const isExtraction = (request: RecordedRequest): boolean =>
  request.body.includes("You convert an assistant's plain-text questions");
const extractionsOf = (server: LocalServer): readonly RecordedRequest[] =>
  server.requests.filter((request) => isExtraction(request));

const answerScript: ChatScript = (request) => {
  if (isExtraction(request)) return askCall(EXTRACTED_FORM);
  return sentText(request, "user").includes("Color:")
    ? { text: FINISHED }
    : { text: ASSISTANT_QUESTION };
};

const model = (id: string): Readonly<Record<string, unknown>> => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 1_000_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

async function modelsWorld({ chatServer, world }: Scenario): Promise<LocalServer> {
  const server = await chatServer(answerScript);
  const shared = { baseUrl: `${server.baseUrl}/v1`, api: "openai-completions" };
  world.writeAgentFile("models.json", {
    providers: {
      probe: { ...shared, apiKey: "local", models: [model("m"), model("preferred")] },
      // No credentials at all: Pi still answers `getApiKeyAndHeaders` with `ok: true`.
      keyless: { ...shared, models: [model("k")] },
      // No credentials and a required header: `getApiKeyAndHeaders` answers `ok: false`.
      bearer: { ...shared, authHeader: true, models: [model("b")] },
      // Configured, but its key command fails when it is resolved.
      failing: { ...shared, apiKey: "!exit 3", models: [model("f")] },
    },
  });
  return server;
}

const extractionConfig = (models: readonly (readonly [string, string])[]): unknown => ({
  schemaVersion: 5,
  answer: { extractionModels: models.map(([provider, id]) => ({ provider, id })) },
  notifications: { enabled: false },
});

async function chatUntilAssistantAsks(terminal: Terminal): Promise<void> {
  await terminal.waitForText(ASSISTANT_QUESTION);
  terminal.send("/answer\r");
}

async function answerFirstOption(terminal: Terminal): Promise<void> {
  await terminal.waitForText(EXTRACTED);
  await submitFirstOption(terminal);
}

function assertAnswerDelivered(server: LocalServer, extractionModel: string): void {
  const extractions = extractionsOf(server);
  assert.equal(extractions.length, 1);
  const [extraction] = extractions;
  assert.ok(extraction !== undefined);
  const body = bodyOf(extraction);
  assert.equal(body["model"], extractionModel);
  assert.ok(extraction.body.includes(ASSISTANT_QUESTION), "the excerpt reaches the extractor");
  assert.ok(extraction.body.includes(USER_TURN), "the preceding turn reaches the extractor");
  assert.ok(JSON.stringify(body["tools"]).includes("ask_user_question"));
  assert.ok(sentText(server.requests.at(-1), "user").includes("Color: Red"));
}

scenario(
  "/answer falls back to the chat model when only the chat model has credentials",
  PACKAGES,
  async (context) => {
    const server = await modelsWorld(context);
    const terminal = context.terminal([...PROBE_ARGS, USER_TURN], { env: NO_DEFAULT_CREDENTIALS });
    await chatUntilAssistantAsks(terminal);
    await terminal.waitForText("using current chat model probe/m");
    await answerFirstOption(terminal);
    assertAnswerDelivered(server, "m");
    assert.ok(!terminal.text().includes("Provider is not configured"), terminal.text());
  },
);

scenario(
  "/answer uses the first configured extraction model that has credentials",
  PACKAGES,
  async (context) => {
    const server = await modelsWorld(context);
    context.world.writeAgentFile(
      "pi-ask.json",
      extractionConfig([
        ["keyless", "k"],
        ["bearer", "b"],
        ["failing", "f"],
        ["probe", "preferred"],
      ]),
    );
    const terminal = context.terminal([...PROBE_ARGS, USER_TURN]);
    await chatUntilAssistantAsks(terminal);
    await answerFirstOption(terminal);
    assertAnswerDelivered(server, "preferred");
    assert.ok(!terminal.text().includes("using current chat model"), terminal.text());
  },
);

scenario(
  "/answer skips a configured model outside the session's --models scope",
  PACKAGES,
  async (context) => {
    const server = await modelsWorld(context);
    context.world.writeAgentFile(
      "pi-ask.json",
      extractionConfig([
        ["probe", "preferred"],
        ["probe", "m"],
      ]),
    );
    const terminal = context.terminal(["--models", "probe/m", ...PROBE_ARGS, USER_TURN]);
    await chatUntilAssistantAsks(terminal);
    await answerFirstOption(terminal);
    assertAnswerDelivered(server, "m");
    assert.ok(!terminal.text().includes("using current chat model"), terminal.text());
  },
);

scenario(
  "/answer refuses a chat model outside the --models scope without a model request",
  PACKAGES,
  async (context) => {
    const server = await modelsWorld(context);
    context.world.writeAgentFile("pi-ask.json", extractionConfig([]));
    const session = join(context.world.root, "scoped.jsonl");
    await context.print(["-p", "--session", session, ...PROBE_ARGS, USER_TURN]);
    const terminal = context.terminal([
      "--session",
      session,
      "--models",
      "probe/preferred",
      ...PROBE_ARGS,
    ]);
    await terminal.waitForText(ASSISTANT_QUESTION);
    const before = server.requests.length;
    terminal.send("/answer\r");
    await terminal.waitForText("No available extraction model in the current session model scope");
    assert.equal(server.requests.length, before);
  },
);

const KEYLESS_CHAT_MODELS: readonly (readonly [string, string])[] = [
  ["keyless", "k"],
  ["bearer", "b"],
];

for (const [provider, id] of KEYLESS_CHAT_MODELS) {
  const name = `${provider}/${id}`;
  scenario(
    `/answer names the missing auth of a chat model on a keyless provider (${name})`,
    PACKAGES,
    async (context) => {
      const server = await modelsWorld(context);
      const session = join(context.world.root, "keyless.jsonl");
      await context.print(["-p", "--session", session, ...PROBE_ARGS, USER_TURN]);
      const before = server.requests.length;
      const terminal = context.terminal(
        ["--session", session, "--provider", provider, "--model", id, "--approve"],
        { env: NO_DEFAULT_CREDENTIALS },
      );
      await terminal.waitForText(ASSISTANT_QUESTION);
      terminal.send("/answer\r");
      await terminal.waitForText(`No auth for fallback chat model: ${name}`);
      assert.equal(server.requests.length, before, "no model request may leave");
    },
  );
}
