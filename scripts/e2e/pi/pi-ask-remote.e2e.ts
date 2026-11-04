// Forms reached other ways than the tool's first call: `/ask:replay` after a
// cancel, and a bridge extension answering over Pi's real `pi.events` bus.
import assert from "node:assert/strict";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import {
  ESCAPE,
  FINISHED,
  FORM,
  PACKAGES,
  QUESTION,
  askResultDetails,
  askingScript,
  bridgeEvents,
  bridgeExtension,
  sentText,
} from "./pi-ask-support.ts";
import { scenario } from "./scenario.ts";
import { PROBE_ARGS } from "./world.ts";

const PROMPT = "Ask the questions";
const REPLAYED_ANSWER = "ASK_MODEL_REPLIED_TO_REPLAY";

scenario(
  "/ask:replay reopens a cancelled form and its answer reaches the model",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer((request) => {
      if (sentText(request, "user").includes("Scope: All packages"))
        return { text: REPLAYED_ANSWER };
      return askingScript(FORM)(request);
    });
    const session = join(world.root, "replay.jsonl");
    const form = terminal(["--session", session, ...PROBE_ARGS, PROMPT]);
    await form.waitForText(QUESTION);
    const beforeCancel = form.mark();
    form.send(ESCAPE);
    await form.waitForText(FINISHED, { mark: beforeCancel });
    assert.equal(askResultDetails(session)?.["cancelled"], true);
    const before = server.requests.length;
    const beforeReplay = form.mark();
    form.send("/ask:replay\r");
    await form.waitForText(QUESTION, { mark: beforeReplay });
    const mark = form.mark();
    form.send("1");
    await form.waitForText("Review answers", { mark });
    form.send("\r");
    await form.waitForText(REPLAYED_ANSWER, { mark });
    assert.equal(server.requests.length, before + 1);
    assert.ok(sentText(server.requests.at(-1), "user").includes("Scope: All packages"));
  },
);

scenario(
  "a bridge extension answers a form over pi.events and sees its lifecycle",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const server = await probeServer(askingScript(FORM));
    const bridge = bridgeExtension(world.root);
    const session = join(world.root, "remote.jsonl");
    const form = terminal(["-e", bridge.path, "--session", session, ...PROBE_ARGS, PROMPT], {
      env: { ...bridge.env, ASK_BRIDGE_ANSWER: "changed" },
    });
    await form.waitForText(FINISHED);
    assert.equal(sentText(server.requests.at(-1), "tool"), "Scope: Changed packages");
    assert.partialDeepStrictEqual(askResultDetails(session), {
      cancelled: false,
      answers: { scope: { values: ["changed"] } },
    });
    const events = bridgeEvents(bridge.log);
    const started = events.find((event) => event.channel === "started")?.data;
    assert.ok(isRecord(started));
    assert.equal(started["source"], "tool");
    assert.equal(started["toolCallId"], "call_e2e");
    assert.partialDeepStrictEqual(events.find((event) => event.channel === "submit-result")?.data, {
      requestId: "bridge-answer",
      flowId: started["flowId"],
      ok: true,
    });
    assert.partialDeepStrictEqual(events.find((event) => event.channel === "completed")?.data, {
      flowId: started["flowId"],
      source: "tool",
      result: { cancelled: false, answers: { scope: { values: ["changed"] } } },
    });
  },
);

scenario(
  "a submit to no active flow gets one flow_not_found, also after /reload",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    await probeServer(() => ({ text: FINISHED }));
    const bridge = bridgeExtension(world.root);
    const chat = terminal(["-e", bridge.path, ...PROBE_ARGS, "hello"], { env: bridge.env });
    await chat.waitForText(FINISHED);
    const beforeReload = chat.mark();
    chat.send("/reload\r");
    await chat.waitForText("Reloaded", { mark: beforeReload });
    const beforeLate = chat.mark();
    chat.send("/bridge-late\r");
    await chat.waitForText("bridge-late sent", { mark: beforeLate });
    const results = bridgeEvents(bridge.log).filter(
      ({ channel, data }) =>
        channel === "submit-result" && isRecord(data) && data["requestId"] === "bridge-late",
    );
    assert.equal(results.length, 1, JSON.stringify(results));
    assert.partialDeepStrictEqual(results[0]?.data, { ok: false, error: "flow_not_found" });
  },
);
