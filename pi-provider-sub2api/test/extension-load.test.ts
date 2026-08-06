import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
