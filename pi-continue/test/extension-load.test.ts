import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const loaderUrl = pathToFileURL(join(dirname(codingAgentEntry), "core/extensions/loader.js")).href;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories = new Set<string>();

interface ExtensionLoaderModule {
  loadExtensions(paths: string[], cwd: string): Promise<LoadExtensionsResult>;
}

afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;

  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

async function isolatedAgentDir(): Promise<string> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-continue-load-"));
  temporaryDirectories.add(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

async function loadExtensions(agentDir: string, paths: string[]): Promise<LoadExtensionsResult> {
  const loader = (await import(loaderUrl)) as ExtensionLoaderModule;
  return loader.loadExtensions(paths, agentDir);
}

describe("Pi extension loading", () => {
  it("loads through Pi's real extension loader and registers /continue", async () => {
    const agentDir = await isolatedAgentDir();
    const result = await loadExtensions(agentDir, [extensionPath]);

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    const extension = result.extensions[0];
    expect(extension?.resolvedPath).toBe(extensionPath);
    expect(extension?.commands.has("continue")).toBe(true);
    expect(extension?.commands.get("continue")?.description).toBe(
      "Retry the interrupted or failed turn with the currently selected model",
    );
  });

  it("reports a broken extension through the loader result instead of muting the console", async () => {
    const agentDir = await isolatedAgentDir();
    const brokenPath = join(agentDir, "broken-extension.ts");
    await writeFile(brokenPath, 'throw new Error("broken extension");\n');

    const result = await loadExtensions(agentDir, [brokenPath]);

    expect(result.extensions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe(brokenPath);
    expect(result.errors[0]?.error).toContain("broken extension");
  });
});
