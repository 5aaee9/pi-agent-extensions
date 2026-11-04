import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

const hostManifest = JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8")) as {
  bin: { pi: string };
};
const cliPath = join(getPackageDir(), hostManifest.bin.pi);
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const numbers = Array.from({ length: 300 }, (_, index) => String(((index * 17) % 355) + 1)).join(
  ", ",
);

interface RpcEvent {
  type?: string;
  id?: string;
  success?: boolean;
  message?: unknown;
  data?: { messages?: Array<{ customType?: string; content: string }> };
}

interface TraceSession {
  requests: Array<{
    model: string;
    reasoning_effort?: string;
    tools?: unknown[];
    messages: unknown[];
  }>;
  events: RpcEvent[];
  responses: ServerResponse[];
  send: (command: Record<string, unknown>) => void;
  waitForEvent: (predicate: (event: RpcEvent) => boolean) => Promise<RpcEvent>;
}

async function withTrace(
  options: {
    override?: string;
    childExtension?: string;
    holdResponses?: boolean;
    hostOnPath?: boolean;
  },
  run: (session: TraceSession) => Promise<void>,
): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "model-trace-command-"));
  const requests: TraceSession["requests"] = [];
  const responses: ServerResponse[] = [];
  let child: ChildProcessWithoutNullStreams | undefined;
  const killGroup = (): void => {
    if (!child?.pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  process.on("exit", killGroup);
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      responses.push(response);
      if (options.holdResponses) return;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finishReason: string | null): string =>
        `data: ${JSON.stringify({
          id: "trace-probe",
          object: "chat.completion.chunk",
          created: 1,
          model: "local",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`;
      response.write(chunk({ role: "assistant", content: numbers }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Model server did not bind");
    const agentDir = join(temp, "agent");
    const binDir = join(temp, "bin");
    await mkdir(agentDir);
    await mkdir(binDir);
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultThinkingLevel: "high" }),
    );
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          audit: {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            apiKey: "local-probe-key",
            models: [
              {
                id: "local",
                reasoning: true,
                thinkingLevelMap: { off: "none", high: "high" },
                compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        },
      }),
    );
    if (options.childExtension) {
      const extensionsDir = join(agentDir, "extensions");
      await mkdir(extensionsDir);
      await writeFile(join(extensionsDir, "probe-fixture.ts"), options.childExtension);
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: options.hostOnPath
        ? [join(getPackageDir(), "..", "..", ".bin"), dirname(process.execPath)].join(delimiter)
        : binDir,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
    };
    delete env.PI_MODEL_TRACE_BIN;
    if (options.override) env.PI_MODEL_TRACE_BIN = options.override;
    child = spawn(
      process.execPath,
      [
        cliPath,
        "-ne",
        "-e",
        extensionPath,
        "--model",
        "audit/local",
        "--thinking",
        "off",
        "--mode",
        "rpc",
        "--no-session",
        "-a",
      ],
      { cwd: temp, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] },
    );
    const processDone = new Promise<void>((resolve) => {
      child?.once("close", resolve);
    });
    const events: RpcEvent[] = [];
    let pending = "";
    let stderr = "";
    let processError: Error | undefined;
    child.once("error", (error) => {
      processError = error;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          processError = new Error(`Invalid RPC JSON: ${line}`);
        }
      }
    });
    const session: TraceSession = {
      events,
      requests,
      responses,
      send(command) {
        child?.stdin.write(`${JSON.stringify(command)}\n`);
      },
      async waitForEvent(predicate) {
        let result: RpcEvent | undefined;
        await vi.waitFor(
          () => {
            if (processError) throw processError;
            if (child?.exitCode !== null) throw new Error(`Pi exited: ${stderr}`);
            result = events.find(predicate);
            expect(result).toBeDefined();
          },
          { timeout: 15000, interval: 20 },
        );
        if (!result) throw new Error("RPC event not found");
        return result;
      },
    };
    try {
      session.send({ id: "commands", type: "get_commands" });
      await session.waitForEvent((event) => event.id === "commands" && event.success === true);
      await run(session);
    } finally {
      killGroup();
      await processDone;
    }
  } finally {
    killGroup();
    process.off("exit", killGroup);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
}

async function runCommand(session: TraceSession): Promise<string> {
  session.send({ id: "probe", type: "prompt", message: "/model-trace audit/local" });
  await session.waitForEvent(
    (event) => typeof event.message === "string" && event.message.startsWith("ModelTrace finished"),
  );
  session.send({ id: "messages", type: "get_messages" });
  const event = await session.waitForEvent((value) => value.id === "messages");
  const report = event.data?.messages?.find((message) => message.customType === "model-trace");
  expect(report).toBeDefined();
  return report?.content ?? "";
}

describe("/model-trace through Pi RPC", () => {
  it("uses the current host without Pi on PATH and preserves thinking off in every probe", async () => {
    await withTrace({}, async (session) => {
      const report = await runCommand(session);
      expect(report).toContain("归因结果");
      expect(report).toContain("有效回答 3/3");
      expect(session.requests).toHaveLength(3);
      for (const request of session.requests) {
        expect(request.model).toBe("local");
        expect(request.reasoning_effort).toBe("none");
        expect(request.tools ?? []).toHaveLength(0);
      }
      const counts = session.requests.map((request) =>
        Number(/(\d+) 个 1 到 355/.exec(JSON.stringify(request.messages))?.[1]),
      );
      expect(new Set(counts).size).toBe(3);
      for (const count of counts) {
        expect(count).toBeGreaterThanOrEqual(292);
        expect(count).toBeLessThanOrEqual(332);
      }
    });
  }, 30000);

  it("honors an explicit executable override and reports execution failures", async () => {
    await withTrace({ override: join(tmpdir(), "missing-model-trace-binary") }, async (session) => {
      const report = await runCommand(session);
      expect(report).toContain("分析失败");
      expect(report).toContain("probe exited 1:");
      expect(report).toContain("ENOENT");
      expect(session.requests).toHaveLength(0);
    });
  }, 30000);

  it("rejects numeric output from failed child processes instead of scoring it", async () => {
    await withTrace(
      {
        hostOnPath: true,
        childExtension: `import { writeSync } from "node:fs"; export default function (pi) { pi.on("session_start", () => { writeSync(1, ${JSON.stringify(numbers)}); process.exit(1); }); }`,
      },
      async (session) => {
        const report = await runCommand(session);
        expect(report).toContain("分析失败");
        expect(report).toContain("probe exited 1:");
        expect(report).not.toContain("归因结果");
        expect(session.requests).toHaveLength(0);
      },
    );
  }, 30000);

  it("reports excessive probe output instead of scoring its partial numbers", async () => {
    await withTrace(
      {
        childExtension:
          'export default function (pi) { pi.on("session_start", () => { process.stdout.write("123 ".repeat(300000)); }); }',
      },
      async (session) => {
        const report = await runCommand(session);
        expect(report).toContain("分析失败");
        expect(report).toContain("probe exceeded 1 MiB output limit");
        expect(report).not.toContain("归因结果");
      },
    );
  }, 30000);

  it("cancels running probes on session replacement without retrying or publishing a late report", async () => {
    await withTrace({ holdResponses: true }, async (session) => {
      session.send({ id: "probe", type: "prompt", message: "/model-trace audit/local" });
      await vi.waitFor(() => expect(session.requests).toHaveLength(3), { timeout: 15000 });
      session.send({ id: "new", type: "new_session" });
      await session.waitForEvent((event) => event.id === "new" && event.success === true);
      await vi.waitFor(() =>
        expect(session.responses.every((response) => response.destroyed)).toBe(true),
      );
      await session.waitForEvent((event) => event.id === "probe");
      session.send({ id: "messages", type: "get_messages" });
      const event = await session.waitForEvent((value) => value.id === "messages");
      expect(event.data?.messages).toEqual([]);
      expect(session.requests).toHaveLength(3);
      expect(
        session.events.some(
          (value) => typeof value.message === "string" && value.message.includes("retrying"),
        ),
      ).toBe(false);
    });
  }, 30000);
});
