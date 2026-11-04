// The form under a person's hands: dismissing cannot lose typed answers by
// accident, and no label or width can overflow the terminal, which Pi treats as
// fatal.
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  DOWN,
  ENTER,
  ESCAPE,
  FINISHED,
  PACKAGES,
  QUESTION,
  TAB,
  askCall,
  askResultDetails,
  askingScript,
  sentText,
} from "./pi-ask-support.ts";
import type { Terminal } from "./pty.ts";
import { scenario } from "./scenario.ts";
import { rolesOf } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const PROMPT = "Ask the questions";
const NOTICE = "Unsaved ask answers or drafts";
const SECOND_QUESTION = "ASK_SECOND_PROMPT";
const CTRL_C = "\u0003";

const TWO_QUESTIONS = {
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
    {
      id: "speed",
      label: "Speed",
      prompt: `${SECOND_QUESTION}: How fast?`,
      options: [
        { value: "fast", label: "Fast" },
        { value: "slow", label: "Slow" },
      ],
    },
  ],
};

/** Presses keys and resolves once `expected` is drawn in response to them. */
async function press(terminal: Terminal, keys: string, expected: string): Promise<void> {
  const mark = terminal.mark();
  terminal.send(keys);
  await terminal.waitForText(expected, { mark });
}

scenario(
  "the dismiss guard keeps a dirty form open until a second press, and a tab change re-arms it",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(TWO_QUESTIONS));
    const session = join(world.root, "guard.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    await press(form, "1", SECOND_QUESTION);
    const asked = server.requests.length;
    await press(form, ESCAPE, NOTICE);
    await press(form, TAB, "Review answers");
    await press(form, ESCAPE, NOTICE);
    assert.equal(server.requests.length, asked, "the guard must keep the form open");
    assert.equal(askResultDetails(session), undefined);
    await press(form, ESCAPE, FINISHED);
    assert.equal(askResultDetails(session)?.["cancelled"], true);
  },
);

scenario(
  "the dismiss guard protects a draft that is still being typed",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(TWO_QUESTIONS));
    const session = join(world.root, "draft.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    form.send(DOWN);
    await press(form, DOWN, "Type your own");
    await press(form, "draft text", "draft text");
    const asked = server.requests.length;
    await press(form, CTRL_C, NOTICE);
    assert.equal(server.requests.length, asked, "the guard must keep the draft");
    await press(form, CTRL_C, FINISHED);
    assert.equal(askResultDetails(session)?.["cancelled"], true);
  },
);

scenario(
  "confirmDismissWhenDirty false dismisses a dirty form on the first press",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    world.writeAgentFile("pi-ask.json", {
      schemaVersion: 5,
      behaviour: { confirmDismissWhenDirty: false },
      notifications: { enabled: false },
    });
    await probeServer(askingScript(TWO_QUESTIONS));
    const session = join(world.root, "unguarded.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    await press(form, "1", SECOND_QUESTION);
    await press(form, ESCAPE, FINISHED);
    assert.equal(askResultDetails(session)?.["cancelled"], true);
    assert.ok(!form.text().includes(NOTICE));
  },
);

const PREVIEW_FORM = {
  questions: [
    {
      id: "layout",
      label: "Layout",
      type: "preview",
      prompt: `${QUESTION}: Which layout?`,
      options: [
        { value: "wide", label: "Wide", preview: "PREVIEW_OF_WIDE", recommended: true },
        { value: "narrow", label: "Narrow", preview: "PREVIEW_OF_NARROW" },
      ],
    },
  ],
};

scenario(
  "the preview pane follows the selected option and gives way to the custom editor",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(PREVIEW_FORM));
    const session = join(world.root, "preview.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT], { cols: 120 });
    await form.waitForText(QUESTION);
    await form.waitForText("PREVIEW_OF_WIDE");
    assert.ok(form.text().includes("(recommended)"), form.text());
    await press(form, DOWN, "PREVIEW_OF_NARROW");
    const beforeCustom = form.mark();
    await press(form, DOWN, "Type your own");
    await press(form, "inline answer", "inline answer");
    const drawn = form.raw().slice(beforeCustom);
    assert.ok(!drawn.includes("PREVIEW_OF"), `the pane must be gone: ${drawn}`);
    assert.ok(!drawn.includes("No preview available"), `the pane must be gone: ${drawn}`);
    await press(form, ENTER, "Review answers");
    await press(form, ENTER, FINISHED);
    assert.equal(sentText(server.requests.at(-1), "tool"), "Layout: inline answer");
  },
);

const WIDE_GLYPHS_FORM = {
  questions: [
    {
      id: "scope",
      label: "範囲🎯範囲",
      prompt:
        "Pick 変更するパッケージはどれですか🎉🎉🎉 with a long ascii_token_that_cannot_wrap_at_all",
      options: [
        { value: "all", label: "すべてのパッケージ🚀", description: "全部を対象にします🌏" },
        { value: "changed", label: "変更されたパッケージのみ✨" },
      ],
    },
    {
      id: "speed",
      label: "速度🚄",
      prompt: "Then 速度を選んでください⚡",
      options: [
        { value: "fast", label: "速い🐇" },
        { value: "slow", label: "遅い🐢" },
      ],
    },
  ],
};
const ALIVE = "DONE";

for (const cols of [12, 20, 30]) {
  scenario(
    `a CJK and emoji form stays alive and answerable at ${String(cols)} columns`,
    PACKAGES,
    async ({ world, probeServer, terminal }) => {
      const server = await probeServer((request) =>
        rolesOf(request).includes("tool") ? { text: ALIVE } : askCall(WIDE_GLYPHS_FORM),
      );
      // Only the regular renderer treats an over-wide line as fatal; fullscreen clips it.
      world.mergeSettings({ tuiMode: "regular" });
      const session = join(world.root, "narrow.jsonl");
      const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT], { cols });
      await form.waitForText("Pick");
      await press(form, "1", "Then");
      form.send(DOWN);
      await press(form, DOWN, "Type");
      await press(form, "入力🎉x", "入");
      await press(form, ENTER, "1.");
      const mark = form.mark();
      form.send(ENTER);
      await form.waitForText(ALIVE, { mark });
      assert.equal(form.exitCode(), undefined, "pi must still be running");
      assert.ok(sentText(server.requests.at(-1), "tool").includes("入力🎉x"));
      assert.partialDeepStrictEqual(askResultDetails(session), {
        answers: { scope: { values: ["all"] }, speed: { customText: "入力🎉x" } },
      });
    },
  );
}
