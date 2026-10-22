import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as piAi from "@earendil-works/pi-ai/compat";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const loaderUrl = pathToFileURL(join(dirname(codingAgentEntry), "core/extensions/loader.js")).href;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  vi.restoreAllMocks();
});

describe("Pi extension loading", () => {
  it("registers native compaction when host imports are virtual", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sub2api-virtual-host-"));
    const originalArgv = process.argv;
    try {
      for (const name of ["codex-compaction.ts", "util.ts", "types.ts"]) {
        await copyFile(new URL(`../${name}`, import.meta.url), join(dir, name));
      }
      process.argv = [process.execPath, join(dirname(codingAgentEntry), "cli.js")];
      const { createJiti } = await import(
        pathToFileURL(createRequire(codingAgentEntry).resolve("jiti")).href
      );
      const jiti = createJiti(codingAgentEntry, {
        virtualModules: {
          "@earendil-works/pi-ai": piAi,
          "@earendil-works/pi-coding-agent": codingAgent,
        },
        tryNative: false,
      });
      const { registerCodexCompaction }: typeof import("../codex-compaction.ts") =
        await jiti.import(join(dir, "codex-compaction.ts"));
      const on = vi.fn<codingAgent.ExtensionAPI["on"]>();
      const registerCommand = vi.fn<codingAgent.ExtensionAPI["registerCommand"]>();
      registerCodexCompaction(
        { on, registerCommand } as unknown as codingAgent.ExtensionAPI,
        () => undefined,
        () => undefined,
        true,
      );
      expect(registerCommand).toHaveBeenCalledWith("openai-compress", expect.any(Object));
      expect(on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
      expect(on).toHaveBeenCalledWith("before_provider_request", expect.any(Function));
    } finally {
      process.argv = originalArgv;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads through Pi's real extension loader", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-provider-sub2api-load-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { loadExtensions } = await import(loaderUrl);
      const result = await loadExtensions([extensionPath], agentDir);

      expect(result.errors).toEqual([]);
      expect(result.extensions).toHaveLength(1);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
