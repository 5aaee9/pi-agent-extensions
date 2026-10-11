import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRelayConfigs, parseRelayConfig, resolveCredentialCommand } from "../config.ts";

function command(source: string) {
  return `!exec "${process.execPath}" -e '${source.replaceAll("'", "'\"'\"'")}'`;
}

describe("credential commands", () => {
  it("resolves on load without re-expanding output and supports a literal leading bang", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sub2api-command-"));
    try {
      const path = join(dir, "sub2api.json");
      await writeFile(
        path,
        JSON.stringify({
          command: {
            baseURL: "https://example.com",
            token: command('console.log("!literal$KEY")'),
          },
        }),
      );
      expect((await loadRelayConfigs(path))[0]!.apiKey).toBe("!literal$KEY");
      expect(
        parseRelayConfig("literal", {
          baseURL: "https://example.com",
          token: "$!literal$KEY",
        }).apiKey,
      ).toBe("!literal$KEY");
      await writeFile(
        path,
        JSON.stringify({
          command: {
            baseURL: "https://example.com",
            token: "!exit 1",
          },
        }),
      );
      await expect(loadRelayConfigs(path)).rejects.toThrow("Credential command failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("trims stdout without expanding the returned secret", async () => {
    expect(await resolveCredentialCommand(command('console.log(" !literal$KEY${OTHER} ")'))).toBe(
      "!literal$KEY${OTHER}",
    );
  });

  it.each([
    "",
    'process.stdout.write("   ")',
    'process.stdout.write("secret\\nsecond-line")',
    'process.stdout.write("secret\\u0000")',
    'process.stdout.write("x".repeat(70 * 1024))',
    'console.log("secret-stdout"); console.error("secret-stderr"); process.exit(1)',
  ])("rejects invalid output or failure without exposing secrets: %s", async (source) => {
    let failure: unknown;
    try {
      await resolveCredentialCommand(command(source));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Credential command");
    expect(String(failure)).not.toContain("secret");
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("stdout");
    expect(failure).not.toHaveProperty("stderr");
  });

  it("times out a stuck command", async () => {
    await expect(resolveCredentialCommand(command("setInterval(() => {}, 1000)"))).rejects.toThrow(
      "Credential command failed",
    );
  }, 15_000);

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveCredentialCommand(command("setInterval(() => {}, 1000)"), controller.signal),
    ).rejects.toThrow("Credential command failed");
  });
});
