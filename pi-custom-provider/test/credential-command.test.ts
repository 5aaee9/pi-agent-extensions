import { describe, expect, it } from "vitest";
import { resolveConfigValue, resolveCredentialCommand, toProviderValue } from "../config.ts";

function command(source: string) {
  return `!exec "${process.execPath}" -e '${source.replaceAll("'", "'\"'\"'")}'`;
}

describe("credential commands", () => {
  it("preserves literal escapes and does not re-evaluate command output", async () => {
    expect(await resolveConfigValue("$!printf must-not-execute")).toBe("!printf must-not-execute");
    expect(await resolveConfigValue("$$KEY")).toBe("$KEY");
    expect(toProviderValue("$!printf must-not-execute")).toBe("$!printf must-not-execute");
    expect(toProviderValue("$$lowercase")).toBe("$$lowercase");
    expect(await resolveConfigValue(command('console.log("!literal$KEY")'))).toBe("!literal$KEY");
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
