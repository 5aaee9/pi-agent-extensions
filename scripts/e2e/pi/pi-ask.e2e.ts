// `pi-ask` as an installed user meets it: a question answered in a real terminal
// reaches the model, the form's editor keeps Pi's contracts, settings persist,
// commands refuse in RPC, and the bundled skill arrives with the package.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { isRecord } from "../../release/json.ts";
import {
  DOWN,
  ENTER,
  FINISHED,
  FORM,
  PACKAGES,
  QUESTION,
  REVIEW,
  askResultDetails,
  askingScript,
  sentText,
  submitFirstOption,
  waitForSavedBehaviour,
} from "./pi-ask-support.ts";
import type { RpcClient } from "./pi.ts";
import type { Terminal } from "./pty.ts";
import { scenario } from "./scenario.ts";
import { messagesOf } from "./servers.ts";
import { PROBE_ARGS, ROOT_DIR } from "./world.ts";

const PROMPT = "Ask the questions";
const CTRL_K = "\v";

// A partial `keymaps` object is rejected as a whole, so this is the documented
// default set with only the answer editor's submit key changed.
const CUSTOM_SUBMIT_KEYMAPS = {
  global: { dismiss: ["ctrl+c"], settings: ["?"] },
  main: {
    confirm: ["enter"],
    cancel: ["esc"],
    toggle: ["space"],
    changeQuestionType: ["t"],
    nextTab: ["tab", "right"],
    previousTab: ["shift+tab", "left"],
    nextOption: ["down"],
    previousOption: ["up"],
    optionNote: ["n"],
    questionNote: ["shift+n"],
  },
  editor: {
    submit: ["ctrl+k"],
    close: ["esc"],
    nextTabWhenEmpty: ["tab", "right"],
    previousTabWhenEmpty: ["shift+tab", "left"],
    nextOptionWhenEmpty: ["down"],
    previousOptionWhenEmpty: ["up"],
  },
  noteEditor: {
    save: ["enter"],
    close: ["esc"],
    nextTabWhenEmpty: ["tab", "right"],
    previousTabWhenEmpty: ["shift+tab", "left"],
    nextOptionWhenEmpty: ["down"],
    previousOptionWhenEmpty: ["up"],
  },
  settingsModal: {
    close: ["esc", "ctrl+c", "?"],
    nextOption: ["down"],
    previousOption: ["up"],
    toggle: ["enter", "space"],
  },
};

/** Opens the "Type your own" editor of the form's only question. */
async function openCustomEditor(terminal: Terminal): Promise<void> {
  await terminal.waitForText(QUESTION);
  terminal.send(DOWN);
  const mark = terminal.mark();
  terminal.send(DOWN);
  await terminal.waitForText("Type your own", { mark });
}

scenario(
  "answering a question delivers the chosen option to the tool result and the model",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(FORM));
    const session = join(world.root, "answer.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    await submitFirstOption(form);
    assert.equal(sentText(server.requests.at(-1), "tool"), "Scope: All packages");
    assert.partialDeepStrictEqual(askResultDetails(session), {
      cancelled: false,
      mode: "submit",
      answers: { scope: { values: ["all"], labels: ["All packages"] } },
    });
  },
);

scenario(
  "a custom submit key submits typed text where Enter does not, under the kept option label",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    world.writeAgentFile("pi-ask.json", {
      schemaVersion: 5,
      keymaps: CUSTOM_SUBMIT_KEYMAPS,
      notifications: { enabled: false },
    });
    const server = await probeServer(askingScript(FORM));
    const session = join(world.root, "custom.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    const opened = form.mark();
    await openCustomEditor(form);
    form.send("first");
    await form.waitForText("first", { mark: opened });
    const beforeEnter = form.mark();
    form.send(ENTER);
    form.send("second");
    await form.waitForText("second", { mark: beforeEnter });
    const editor = form.text();
    const row = editor.slice(editor.lastIndexOf("Type your own"), editor.lastIndexOf("second"));
    assert.ok(!row.includes("──"), `the editor's own border must not show: ${row}`);
    const beforeSubmit = form.mark();
    form.send(CTRL_K);
    await form.waitForText(REVIEW, { mark: beforeSubmit });
    form.send(ENTER);
    await form.waitForText(FINISHED, { mark: beforeSubmit });
    assert.ok(sentText(server.requests.at(-1), "tool").includes("first"));
    const details = askResultDetails(session);
    assert.ok(isRecord(details?.["answers"]));
    assert.partialDeepStrictEqual(details["answers"], { scope: { customText: "firstsecond" } });
  },
);

scenario(
  "@ in the form's editor lists files through Pi's editor trigger contract",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    // The provider only searches through an `fd` on PATH, which CI does not have.
    const bin = join(world.root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "fd"), "#!/bin/sh\nprintf 'probe-target.txt\\n'\n");
    chmodSync(join(bin, "fd"), 0o755);
    writeFileSync(join(world.cwd, "probe-target.txt"), "target");
    await probeServer(askingScript(FORM));
    const form = terminal([...PROBE_ARGS, PROMPT], {
      env: { PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` },
    });
    await openCustomEditor(form);
    const mark = form.mark();
    form.send("@probe");
    await form.waitForText("probe-target.txt", { mark });
  },
);

scenario(
  "/ask-settings writes the toggled setting and the next process obeys it",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(FORM));
    const settings = terminal(PROBE_ARGS);
    await settings.waitForText("/ commands");
    settings.send("/ask-settings\r");
    await settings.waitFor(
      (text) => /│\s+@indexyz\/pi-ask\s+│/u.test(text),
      "the overlay's header naming this package",
    );
    const config = join(world.agentDir, "pi-ask.json");
    settings.send(" ");
    await waitForSavedBehaviour(config, "autoSubmitWhenAnsweredWithoutNotes");
    await settings.kill();
    const form = terminal([...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    const mark = form.mark();
    form.send(ENTER);
    await form.waitForText(FINISHED, { mark });
    assert.equal(sentText(server.requests.at(-1), "tool"), "Scope: All packages");
  },
);

scenario(
  "answering with a digit auto-submits when the setting is on",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    world.writeAgentFile("pi-ask.json", {
      schemaVersion: 5,
      behaviour: { autoSubmitWhenAnsweredWithoutNotes: true },
    });
    const server = await probeServer(askingScript(FORM));
    const form = terminal([...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    const mark = form.mark();
    form.send("1");
    await form.waitForText(FINISHED, { mark });
    assert.equal(sentText(server.requests.at(-1), "tool"), "Scope: All packages");
  },
);

const RPC_REFUSALS: readonly (readonly [string, string])[] = [
  ["/answer", "/answer requires interactive TUI mode."],
  ["/answer:again", "Ask replay requires interactive TUI mode."],
  ["/ask:replay", "Ask replay requires interactive TUI mode."],
  ["/ask-settings", "/ask-settings requires interactive TUI mode."],
];

async function assertRefusalsFrom(client: RpcClient, index: number): Promise<void> {
  const refusal = RPC_REFUSALS[index];
  if (refusal === undefined) return;
  const [command, message] = refusal;
  const notified = client.next(
    (event) => event["method"] === "notify" && event["message"] === message,
    `the refusal of ${command}`,
  );
  const response = await client.send({ type: "prompt", message: command });
  assert.equal(response["success"], true, JSON.stringify(response));
  const notice = await notified;
  assert.equal(notice["notifyType"], "error");
  await assertRefusalsFrom(client, index + 1);
}

scenario(
  "form commands notify an error in RPC mode and send no model request",
  PACKAGES,
  async ({ probeServer, rpc }) => {
    const server = await probeServer(() => ({ text: "an assistant message to extract from" }));
    const client = rpc(["--no-session", ...PROBE_ARGS]);
    await client.prompt("hello");
    const before = server.requests.length;
    await assertRefusalsFrom(client, 0);
    assert.equal(server.requests.length, before);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "the bundled ask-user skill reaches the model after pi install",
  PACKAGES,
  async ({ probeServer, print }) => {
    const server = await probeServer();
    const run = await print(["-p", "--no-session", ...PROBE_ARGS, "hello"]);
    assert.equal(run.code, 0, run.stderr);
    const [request] = server.requests;
    assert.ok(request !== undefined);
    const system = messagesOf(request).find((message) => message.role === "system")?.text ?? "";
    assert.match(system, /<name>ask-user<\/name>/u);
    const location = /<location>(?<path>[^<]*ask-user[^<]*)<\/location>/u.exec(system)?.groups?.[
      "path"
    ];
    assert.ok(location !== undefined, system);
    assert.ok(!location.startsWith(ROOT_DIR), `the skill must come from the install: ${location}`);
    assert.match(readFileSync(location, "utf8"), /name: ask-user/u);
  },
);
