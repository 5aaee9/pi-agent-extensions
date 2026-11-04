import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentSession,
  ExtensionUIContext,
  InlineExtension,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillAutocompleteProvider,
  expandSkillTokens,
  skillsFromCommands,
  type SkillRef,
} from "../index.ts";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

let rootDir: string;
let agentDir: string;
let workDir: string;
let sessions: AgentSession[];

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pi-skill-test-"));
  agentDir = join(rootDir, "agent");
  workDir = join(rootDir, "work");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  // Isolate both config discovery (PI_CODING_AGENT_DIR) and the user-scoped
  // ~/.agents/skills scan (HOME) from the machine running the test.
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("HOME", rootDir);
  sessions = [];
});

afterEach(async () => {
  for (const session of sessions) session.dispose();
  sessions = [];
  vi.unstubAllEnvs();
  await rm(rootDir, { recursive: true, force: true });
});

async function writeSkill(dirName: string, name: string, body: string): Promise<string> {
  const dir = join(agentDir, "skills", dirName);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "SKILL.md");
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n${body}\n`,
  );
  return filePath;
}

/** A real extension whose only job is to record the command list Pi assembles. */
function commandProbe(captured: { commands: SlashCommandInfo[] }): InlineExtension {
  return {
    name: "command-probe",
    hidden: true,
    factory: (pi) => {
      pi.registerCommand("probe-command", {
        description: "Probe extension command",
        handler: async () => {},
      });
      pi.on("session_start", () => {
        captured.commands = pi.getCommands();
      });
    },
  };
}

interface RealSession {
  session: AgentSession;
  loader: DefaultResourceLoader;
  commands: SlashCommandInfo[];
  skills: Map<string, SkillRef>;
  notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
}

/**
 * Drive the package through Pi's real session plane: the real resource loader
 * discovers skills and prompt templates from the isolated agent directory, the
 * real extension loader loads `index.ts`, and the real AgentSession supplies the
 * command list and context the extension consumes.
 */
async function startSession(): Promise<RealSession> {
  const settingsManager = SettingsManager.create(workDir, agentDir);
  const captured = { commands: [] as SlashCommandInfo[] };
  const loader = new DefaultResourceLoader({
    cwd: workDir,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
    extensionFactories: [commandProbe(captured)],
    // An AGENTS.md above the temp directory must not leak into the plane.
    noContextFiles: true,
  });
  await loader.reload();

  const { session, extensionsResult } = await createAgentSession({
    cwd: workDir,
    agentDir,
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
  });
  if (extensionsResult.errors.length > 0) {
    throw new Error(
      `Pi failed to load the extension: ${extensionsResult.errors
        .map(({ path, error }) => `${path}: ${error}`)
        .join("; ")}`,
    );
  }

  const notifications: RealSession["notifications"] = [];
  // Boundary: Pi's UI context is the client side of the host's UI port (the
  // terminal in interactive mode, the protocol in RPC mode). Only its `notify`
  // member, the seam a UI client would render, is swapped for a recorder; the
  // runner, session, and every other UI member stay Pi's own.
  const uiContext: ExtensionUIContext = {
    // Keep Pi's real no-op UI behavior and observe the one call these tests assert on.
    ...session.extensionRunner.getUIContext(),
    notify: (message, type) => {
      notifications.push({ message, type });
    },
  };
  await session.bindExtensions({ mode: "print", uiContext });
  sessions.push(session);

  return {
    session,
    loader,
    commands: captured.commands,
    skills: skillsFromCommands(captured.commands),
    notifications,
  };
}

type AgentMessage = AgentSession["messages"][number];

function customMessages(session: AgentSession): Array<Extract<AgentMessage, { role: "custom" }>> {
  return session.messages.filter(
    (message): message is Extract<AgentMessage, { role: "custom" }> => message.role === "custom",
  );
}

function getSkill(skills: ReadonlyMap<string, SkillRef>, name: string): SkillRef {
  const skill = skills.get(name);
  if (!skill) throw new Error(`Skill "${name}" was not discovered from disk`);
  return skill;
}

async function writePromptTemplate(name: string): Promise<void> {
  const dir = join(agentDir, "prompts");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.md`),
    `---\ndescription: Test prompt ${name}\n---\n\nReview the staged changes.\n`,
  );
}

describe("real skill discovery and command registration", () => {
  it("discovers skills on disk and exposes them as real skill commands", async () => {
    const codeReviewPath = await writeSkill("code-review", "code-review", "Review the code.");
    await writeSkill("tdd", "tdd", "Write the test first.");
    await writePromptTemplate("review");

    const { loader, commands, skills } = await startSession();

    const byName = new Map(commands.map((command) => [command.name, command]));
    expect(byName.get("skill:code-review")?.source).toBe("skill");
    expect(byName.get("skill:code-review")?.sourceInfo.path).toBe(codeReviewPath);
    expect(byName.get("skill:tdd")?.source).toBe("skill");
    expect(byName.get("probe-command")?.source).toBe("extension");
    expect(byName.get("review")?.source).toBe("prompt");

    expect([...skills.keys()].sort()).toEqual(["code-review", "tdd"]);
    const codeReview = getSkill(skills, "code-review");
    expect(codeReview.filePath).toBe(codeReviewPath);
    expect(codeReview.baseDir).toBe(
      loader.getSkills().skills.find((skill) => skill.name === "code-review")?.baseDir,
    );
  });
});

describe("expandSkillTokens", () => {
  it("leaves unknown tokens and prices untouched", async () => {
    await writeSkill("known", "known", "Known.");
    const { skills } = await startSession();

    const input = "成本 $9.99，变量 $HOME，未知 $nosuch，已知 $known";
    const { expanded, failed, blocks } = await expandSkillTokens(input, skills);

    expect(expanded).toEqual(["known"]);
    expect(failed).toEqual([]);
    expect(blocks.map((block) => block.name)).toEqual(["known"]);
  });

  it("keeps $$name literal as an escape", async () => {
    await writeSkill("esc", "esc", "Escaped?");
    const { skills } = await startSession();

    const { expanded, blocks } = await expandSkillTokens("字面量 $$esc 不是调用", skills);

    expect(expanded).toEqual([]);
    expect(blocks).toEqual([]);
  });

  it("reports a missing skill file as failed", async () => {
    await writeSkill("gone", "gone", "Soon gone.");
    const { skills } = await startSession();
    const missing = getSkill(skills, "gone");
    await unlink(missing.filePath);

    const { expanded, failed, blocks } = await expandSkillTokens("试试 $gone", skills);

    expect(expanded).toEqual([]);
    expect(failed).toEqual(["gone"]);
    expect(blocks).toEqual([]);
  });
});

describe("skill autocomplete provider", () => {
  const signal = new AbortController().signal;

  const forced = { signal, force: true };

  /**
   * Files in the working directory that Pi's real file completion offers for
   * the delegated inputs below, so a delegated answer is a non-empty one that
   * the skill provider could never produce itself.
   */
  const workFiles = ["hello.md", "$HOME-notes.txt", "$zz-notes.txt", "$$code-notes.md"];

  async function providerFor(...names: string[]) {
    for (const [index, name] of names.entries()) {
      await writeSkill(`skill-${index}`, name, `Body for ${name}.`);
    }
    for (const file of workFiles) await writeFile(join(workDir, file), "");
    const { skills, commands } = await startSession();
    // The fallback is Pi's real combined provider over the session's real
    // slash commands and working directory, as the editor builds it.
    const current = new CombinedAutocompleteProvider(
      commands.map(({ name, description }) => ({ name, description })),
      workDir,
    );
    return {
      current,
      provider: createSkillAutocompleteProvider(current, () => skills),
    };
  }

  /** The values of a delegated answer, required to be non-empty. */
  function values(result: { items: Array<{ value: string }> } | null): string[] {
    const items = result?.items.map((item) => item.value) ?? [];
    if (items.length === 0) throw new Error("the fallback provider produced no suggestions");
    return items;
  }

  it("suggests all skills right after `$`", async () => {
    const { provider } = await providerFor("code-review", "tdd");
    const result = await provider.getSuggestions(["使用 $"], 0, 4, { signal });
    expect(result?.prefix).toBe("$");
    expect(result?.items.map((item) => item.value).sort()).toEqual(["$code-review", "$tdd"]);
    expect(result?.items[0]?.description).toContain("Test skill");
  });

  it("filters by typed prefix", async () => {
    const { provider } = await providerFor("code-review", "tdd", "codebase-design");
    const result = await provider.getSuggestions(["$code"], 0, 5, { signal });
    expect(result?.prefix).toBe("$code");
    expect(result?.items.map((item) => item.value).sort()).toEqual([
      "$code-review",
      "$codebase-design",
    ]);
  });

  it("delegates when there is no `$` token or no match", async () => {
    const { current, provider } = await providerFor("code-review");
    const cases: Array<[string[], number, typeof forced | { signal: AbortSignal }, string]> = [
      [["/skill:co"], 9, { signal }, "skill:code-review"],
      [["hello"], 5, forced, "hello.md"],
      [["echo $HO"], 8, forced, "$HOME-notes.txt"],
      [["$zz"], 3, forced, "$zz-notes.txt"],
    ];

    for (const [lines, cursorCol, options, expected] of cases) {
      const delegated = await current.getSuggestions(lines, 0, cursorCol, options);
      expect(values(delegated)).toContain(expected);
      const result = await provider.getSuggestions(lines, 0, cursorCol, options);
      expect(values(result)).toContain(expected);
      expect(result).toEqual(delegated);
    }
  });

  it("does not complete `$$name` escape", async () => {
    const { current, provider } = await providerFor("code-review");
    for (const [line, cursorCol] of [
      ["$$code", 6],
      ["a $$", 4],
    ] as const) {
      const result = await provider.getSuggestions([line], 0, cursorCol, forced);
      expect(values(result)).toEqual(["$$code-notes.md"]);
      expect(result).toEqual(await current.getSuggestions([line], 0, cursorCol, forced));
    }
  });

  it("replaces the $ prefix and adds a trailing space on applyCompletion", async () => {
    const { provider } = await providerFor();
    const lines = ["请用 $cod 检查"];
    const result = provider.applyCompletion(
      lines,
      0,
      "请用 $cod".length,
      { value: "$code-review", label: "$code-review" },
      "$cod",
    );
    expect(result.lines[0]).toBe("请用 $code-review 检查");
    expect(result.cursorCol).toBe("请用 ".length + "$code-review".length);
  });

  it("adds a trailing space when the cursor is at end of line", async () => {
    const { provider } = await providerFor();
    const result = provider.applyCompletion(
      ["$cod"],
      0,
      4,
      { value: "$code-review", label: "$code-review" },
      "$cod",
    );
    expect(result.lines[0]).toBe("$code-review ");
    expect(result.cursorCol).toBe("$code-review".length + 1);
  });

  it("delegates applyCompletion for non-$ prefixes", async () => {
    const { current, provider } = await providerFor("code-review");
    const suggestions = await current.getSuggestions(["/skil"], 0, 5, { signal });
    const item = suggestions?.items.find((entry) => entry.value === "skill:code-review");
    if (!item) throw new Error("Pi's command completion did not offer skill:code-review");

    const result = provider.applyCompletion(["/skil"], 0, 5, item, "/skil");
    // Pi's slash-command completion keeps the slash; the skill provider's own
    // replacement would have dropped it.
    expect(result.lines).toEqual(["/skill:code-review "]);
    expect(result).toEqual(current.applyCompletion(["/skil"], 0, 5, item, "/skil"));
  });
});

describe("input handler", () => {
  it("injects one message per distinct skill in first-reference order", async () => {
    await writeSkill("a-skill", "a-skill", "Body A.");
    await writeSkill("b-skill", "b-skill", "Body B.");
    const { session } = await startSession();

    await session.extensionRunner.emitInput(
      "先 $a-skill，再 $b-skill，最后仍用 $a-skill",
      undefined,
      "interactive",
    );

    expect(customMessages(session).map((message) => message.details)).toEqual([
      { name: "a-skill" },
      { name: "b-skill" },
    ]);
  });

  it("passes through input without $ or without matching skills", async () => {
    await writeSkill("known", "known", "Known.");
    const { session, notifications } = await startSession();

    expect(await session.extensionRunner.emitInput("普通消息", undefined, "interactive")).toEqual({
      action: "continue",
    });
    expect(
      await session.extensionRunner.emitInput("价格是 $100", undefined, "interactive"),
    ).toEqual({ action: "continue" });
    expect(session.messages).toEqual([]);
    expect(notifications).toEqual([]);
  });
});
