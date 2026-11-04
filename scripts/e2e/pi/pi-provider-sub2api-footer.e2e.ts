// The footer in a real terminal, because `setFooter` is a no-op in RPC. The usage row
// comes last, on its own, from the relay; badges follow the selected model.
import assert from "node:assert/strict";

import type { Terminal } from "./pty.ts";
import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import { PACKAGE } from "./pi-provider-sub2api-support.ts";

const MANIFEST = manifestOf([
  { slug: "gpt-5.5", supported_reasoning_levels: ["low", "max", "ultra"] },
  { slug: "gpt-5.4", supported_reasoning_levels: ["low"] },
]);

const SUBSCRIPTION = {
  subscription: {
    daily_limit_usd: 100,
    daily_usage_usd: 24,
    weekly_limit_usd: 100,
    weekly_usage_usd: 11,
    monthly_limit_usd: 100,
    monthly_usage_usd: 7,
  },
};

const STATUS_EXTENSION = `
export default function (pi) {
  pi.on("session_start", (_event, ctx) => { ctx.ui.setStatus("e2e", "STATUS-E2E"); });
}
`;

/** The harness's default terminal height, so the last row is where usage must land. */
const TERMINAL_ROWS = 40;
const USAGE_ROW = "relay · d 24% · w 11% · m 7%";

/** What the usage row reads now: repaints only rewrite what changed, so the last one wins. */
const lastRow = (text: string, provider: string): string => {
  const start = text.lastIndexOf(`${provider} · `);
  return start === -1 ? "" : (text.slice(start).split(/\s{3,}|\r|\n/u)[0] ?? "");
};

async function runSlash(term: Terminal, command: string, expected: string): Promise<void> {
  const mark = term.mark();
  term.send(`${command}\r`);
  await term.waitForText(expected, { mark });
}

async function waitForRow(term: Terminal, provider: string, row: string): Promise<void> {
  await term.waitFor(
    (text) => lastRow(text, provider).trim() === row,
    `the usage row to read ${JSON.stringify(row)}`,
  );
}

const terminalArgs = (sessionDir: string, provider: string, model: string): readonly string[] => [
  "--session-dir",
  sessionDir,
  "--provider",
  provider,
  "--model",
  model,
  "--approve",
];

scenario(
  "usage keeps a final row of its own, with the cache hit rate above it and badges per model",
  PACKAGE,
  async ({ server, terminal, world }) => {
    const relay = await startRelay(server, {
      manifest: MANIFEST,
      usage: () => json(SUBSCRIPTION),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const fixture = world.writeAgentFile("e2e-status.ts", STATUS_EXTENSION);
    const term = terminal([
      "--extension",
      fixture,
      ...terminalArgs(world.sessionDir, "relay", "gpt-5.5"),
    ]);
    await term.waitForText(USAGE_ROW);
    const raw = term.raw();
    const between = raw.slice(raw.indexOf("STATUS-E2E"), raw.indexOf("relay · "));
    assert.ok(between.includes(`[${String(TERMINAL_ROWS)};1H`), JSON.stringify(between));

    term.send("hello\r");
    await term.waitForText("↑80 ↓10 R20 CH20.0%");

    await runSlash(term, "/toggle-fast", `${USAGE_ROW} [FAST]`);
    await runSlash(term, "/toggle-daybreak", `${USAGE_ROW} [FAST] [DAYBREAK]`);
    await runSlash(term, "/toggle-ultrafast", `${USAGE_ROW} [ULTRAFAST] [DAYBREAK]`);
    await runSlash(term, "/toggle-ultra", `${USAGE_ROW} [ULTRA ENABLED] [ULTRAFAST] [DAYBREAK]`);
    const usageBefore = relay.at("/usage").length;
    term.send("/model gpt-5.4\r");
    await waitForRow(term, "relay", `${USAGE_ROW} [ULTRA ENABLED]`);
    await relay.waitFor("/usage", usageBefore + 1);
    await runSlash(term, "/toggle-ultra", "Ultra reasoning disabled");
    await waitForRow(term, "relay", USAGE_ROW);
  },
);

scenario(
  "a relay with no usage endpoint says so, and stays that way after a turn",
  PACKAGE,
  async ({ server, terminal, world }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const term = terminal(terminalArgs(world.sessionDir, "relay", "gpt-5.5"));
    await waitForRow(term, "relay", "relay · usage unavailable");
    const before = relay.at("/v1/usage").length;
    term.send("hello\r");
    await term.waitForText("pong");
    await relay.waitFor("/v1/usage", before + 1);
    await waitForRow(term, "relay", "relay · usage unavailable");
  },
);

scenario(
  "the usage row renders cost and tokens, and refreshes after a turn",
  PACKAGE,
  async ({ server, terminal, world }) => {
    const relay = await startRelay(server, {
      manifest: MANIFEST,
      usage: () => json({ usage: { today: { actual_cost: 200.74, total_tokens: 317_700_000 } } }),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const term = terminal(terminalArgs(world.sessionDir, "relay", "gpt-5.5"));
    await waitForRow(term, "relay", "relay · d $200.74 · 317.7m tok");
    relay.route({
      usage: () =>
        json({
          rate_limits: [
            { window: "5h", limit: 100, used: 40 },
            { window: "7d", limit: 200, used: 20 },
          ],
        }),
    });
    term.send("hello\r");
    await waitForRow(term, "relay", "relay · 5h 40% · w 10%");
  },
);

scenario(
  "an xAI model shows its own usage row with no mode or ultra badges from another provider",
  PACKAGE,
  async ({ server, terminal, world }) => {
    const { promise: never } = Promise.withResolvers<void>();
    const held = {
      usage: (): Reply => ({
        ...json({}),
        gate: async (): Promise<void> => {
          await never;
        },
      }),
    };
    const relay = await startRelay(server, {
      inventory: inventoryOf([{ id: "gpt-e2e-relay" }]),
      ...held,
    });
    const grok = await startRelay(server, {
      inventory: inventoryOf([{ id: "grok-e2e" }]),
      ...held,
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-responses" },
      grok: { baseURL: grok.v1, token: "tok", api: "xai" },
    });
    const term = terminal(terminalArgs(world.sessionDir, "relay", "gpt-e2e-relay"));
    await waitForRow(term, "relay", "relay · loading…");
    await runSlash(term, "/toggle-ultra", "Ultra reasoning enabled");
    await runSlash(term, "/toggle-fast", "Fast mode enabled");
    await waitForRow(term, "relay", "relay · loading… [ULTRA ENABLED] [FAST]");
    term.send("/model grok-e2e\r");
    await waitForRow(term, "grok", "grok · loading…");
  },
);
