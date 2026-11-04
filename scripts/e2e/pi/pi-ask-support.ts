// What the `pi-ask` scenarios share: the keys a person presses, the forms the
// model asks with, and readers for what a run leaves in its session file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import type { Terminal } from "./pty.ts";
import type { ChatReply, ChatScript, RecordedRequest } from "./servers.ts";
import { readJsonRecord } from "./world.ts";
import type { EnvExtra } from "./world.ts";
import { messagesOf, rolesOf } from "./servers.ts";

export const ENTER = "\r";
export const ESCAPE = "\u001B";
export const DOWN = "\u001B[B";
export const TAB = "\t";
export const FINISHED = "ASK_MODEL_FINISHED";
export const QUESTION = "ASK_QUESTION_PROMPT";
export const REVIEW = "Review answers";
export const PACKAGES = { packages: ["pi-ask"] };
const FILE_POLL_MS = 20;
const FILE_WAIT_MS = 10_000;

export const FORM = {
  questions: [
    {
      id: "scope",
      label: "Scope",
      prompt: `${QUESTION}: Which packages?`,
      options: [
        { value: "all", label: "All packages" },
        { value: "changed", label: "Changed packages" },
      ],
    },
  ],
};

export const askCall = (form: unknown): ChatReply => ({
  toolCall: { name: "ask_user_question", arguments: JSON.stringify(form) },
});

/** Asks with `form` until a request carries the tool's result, then finishes. */
export const askingScript =
  (form: unknown): ChatScript =>
  (request: RecordedRequest): ChatReply =>
    rolesOf(request).includes("tool") ? { text: FINISHED } : askCall(form);

/** The text of the conversation's messages with `role` in a request Pi sent. */
export function sentText(request: RecordedRequest | undefined, role: string): string {
  if (request === undefined) return "";
  return messagesOf(request)
    .filter((message) => message.role === role)
    .map((message) => message.text)
    .join("\n");
}

export function sessionEntries(path: string): readonly JsonRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line))
    .filter((entry: unknown) => isRecord(entry));
}

/** Details of the last `ask_user_question` result a session recorded. */
export function askResultDetails(path: string): JsonRecord | undefined {
  const results = sessionEntries(path).flatMap((entry) => {
    const { message } = entry;
    return isRecord(message) && message["role"] === "toolResult" ? [message["details"]] : [];
  });
  const last = results.at(-1);
  return isRecord(last) ? last : undefined;
}

/** Answers the open form's question with its first option and submits on the review tab. */
export async function submitFirstOption(terminal: Terminal): Promise<void> {
  const mark = terminal.mark();
  terminal.send("1");
  await terminal.waitForText(REVIEW, { mark });
  terminal.send(ENTER);
  await terminal.waitForText(FINISHED, { mark });
}

// The local bridge `docs/remote-events.md` describes, loaded beside the installed
// package: it logs the public channels and can answer from an extension of its own.
const BRIDGE_SOURCE = `
import { appendFileSync } from "node:fs";

const channel = (name) => \`@eko24ive/pi-ask:\${name}\`;
const log = (name, data) =>
  appendFileSync(process.env.ASK_BRIDGE_LOG, JSON.stringify({ channel: name, data }) + "\\n");

export default function (pi) {
  const subscriptions = ["started", "completed", "submit-result"].map((name) =>
    pi.events.on(channel(name), (data) => log(name, data)),
  );
  pi.on("session_shutdown", () => subscriptions.forEach((unsubscribe) => unsubscribe()));
  const answer = process.env.ASK_BRIDGE_ANSWER;
  if (answer)
    pi.events.on(channel("started"), (event) => {
      pi.events.emit(channel("submit"), {
        version: 1,
        requestId: "bridge-answer",
        flowId: event.flowId,
        response: { kind: "answer", answers: { scope: { values: [answer] } } },
      });
    });
  pi.registerCommand("bridge-late", {
    description: "Submits to a flow that is not active",
    handler: async (_args, ctx) => {
      pi.events.emit(channel("submit"), {
        version: 1,
        requestId: "bridge-late",
        flowId: "no-such-flow",
        response: { kind: "cancel" },
      });
      ctx.ui.notify("bridge-late sent", "info");
    },
  });
}
`;

export interface Bridge {
  readonly path: string;
  readonly log: string;
  readonly env: EnvExtra;
}

export function bridgeExtension(root: string): Bridge {
  const path = join(root, "bridge.ts");
  const log = join(root, "bridge.jsonl");
  writeFileSync(path, BRIDGE_SOURCE);
  return { path, log, env: { ASK_BRIDGE_LOG: log } };
}

export interface BridgeEvent {
  readonly channel: string;
  readonly data: unknown;
}

export function bridgeEvents(log: string): readonly BridgeEvent[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line))
    .filter((entry: unknown) => isRecord(entry))
    .map((entry: JsonRecord) => ({ channel: String(entry["channel"]), data: entry["data"] }));
}

/** Settles once `pi-ask.json` records the setting: the save paints nothing of its own. */
export async function waitForSavedBehaviour(
  path: string,
  key: string,
  deadline: number = Date.now() + FILE_WAIT_MS,
): Promise<void> {
  const behaviour = existsSync(path) ? readJsonRecord(path)["behaviour"] : undefined;
  if (isRecord(behaviour) && behaviour[key] === true) return;
  if (Date.now() > deadline) throw new Error(`${path} never saved ${key}`);
  await delay(FILE_POLL_MS);
  await waitForSavedBehaviour(path, key, deadline);
}
