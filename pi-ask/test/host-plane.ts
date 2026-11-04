import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
export function hostCli(legacy = false): string {
  const packagePath = findPackageJSON(
    legacy ? "pi-coding-agent-legacy" : "@earendil-works/pi-coding-agent",
    import.meta.url,
  );
  if (!packagePath) throw new Error("Pi host is not installed; run npm install");
  const manifest = record(JSON.parse(readFileSync(packagePath, "utf8")));
  const bin = record(manifest.bin).pi;
  if (typeof bin !== "string") throw new Error("Pi host has no CLI entry");
  return join(dirname(packagePath), bin);
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object from the Pi host");
  }
  return value as Record<string, unknown>;
}

export async function createAskPlane(payloads: readonly unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "pi-ask-host-"));
  const agentDir = join(root, "agent");
  const sessionPath = join(root, "session.jsonl");
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(record(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (delta: unknown, finishReason: string | null): void => {
        response.write(
          `data: ${JSON.stringify({
            id: `ask-${requests.length}`,
            object: "chat.completion.chunk",
            created: 1,
            model: "local",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      };
      const index = requests.length - 1;
      if (index < payloads.length) {
        event(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `ask-call-${index}`,
                type: "function",
                function: { name: "ask_user_question", arguments: JSON.stringify(payloads[index]) },
              },
            ],
          },
          null,
        );
        event({}, "tool_calls");
      } else {
        event({ role: "assistant", content: "ASK_HOST_FINISHED" }, null);
        event({}, "stop");
      }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  };
  try {
    await mkdir(agentDir);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No local model address");
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "ask-host": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "local-test-key",
            models: [
              {
                id: "local",
                name: "local",
                reasoning: false,
                input: ["text"],
                contextWindow: 128_000,
                maxTokens: 1024,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
    );
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    return {
      root,
      agentDir,
      requests,
      sessionPath,
      close,
      args: [
        "-ne",
        "-e",
        extensionPath,
        "--offline",
        "--approve",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--model",
        "ask-host/local",
        "--tools",
        "ask_user_question",
        "--session",
        sessionPath,
      ],
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
      entries: async () =>
        (await readFile(sessionPath, "utf8"))
          .trim()
          .split("\n")
          .map((line) => record(JSON.parse(line))),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function runAskTool(payloads: readonly unknown[], mode: "json" | "rpc" = "json") {
  const plane = await createAskPlane(payloads);
  const child = spawn(
    process.execPath,
    [hostCli(), ...plane.args, "--mode", mode, ...(mode === "json" ? ["Ask the questions"] : [])],
    {
      cwd: plane.root,
      env: plane.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  const kill = (): void => {
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (error) {
      if (record(error).code !== "ESRCH") throw error;
    }
  };
  process.once("exit", kill);
  const timer = setTimeout(kill, 30_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data: string) => {
    stderr += data;
  });
  child.stdout.on("data", (data: string) => {
    stdout += data;
    if (mode === "rpc" && stdout.includes('"type":"agent_end"')) child.stdin.end();
  });
  if (mode === "rpc")
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "Ask the questions" })}\n`);
  else child.stdin.end();
  try {
    const [code] = await once(child, "close");
    if (code !== 0) throw new Error(`Pi exited ${String(code)}: ${stderr}\n${stdout}`);
    const events = stdout
      .trim()
      .split("\n")
      .map((line) => record(JSON.parse(line)));
    return { events, requests: plane.requests, entries: await plane.entries(), stderr };
  } finally {
    clearTimeout(timer);
    kill();
    process.removeListener("exit", kill);
    await plane.close();
  }
}
