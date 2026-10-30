import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentSession,
  AutocompleteProviderFactory,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkillAutocompleteProvider,
  expandSkillTokens,
  SKILL_MESSAGE_TYPE,
  skillsFromCommands,
  type SkillRef,
} from "../index.ts";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalHome = process.env.HOME;

let rootDir: string;
let agentDir: string;
let workDir: string;
let sessions: AgentSession[];
let activeServer: Server | undefined;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pi-skill-test-"));
  agentDir = join(rootDir, "agent");
  workDir = join(rootDir, "work");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  // Isolate both config discovery (PI_CODING_AGENT_DIR) and the user-scoped
  // ~/.agents/skills scan (HOME) from the machine running the test.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = rootDir;
  sessions = [];
  activeServer = undefined;
});

afterEach(async () => {
  for (const session of sessions) session.dispose();
  sessions = [];
  activeServer?.closeAllConnections();
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
    activeServer = undefined;
  }
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
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

interface Notifications {
  notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
  autocompleteFactories: AutocompleteProviderFactory[];
}

interface RealSession {
  session: AgentSession;
  loader: DefaultResourceLoader;
  commands: SlashCommandInfo[];
  skills: Map<string, SkillRef>;
  notifications: Notifications["notifications"];
  autocompleteFactories: AutocompleteProviderFactory[];
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

  const notifications: Notifications["notifications"] = [];
  const autocompleteFactories: AutocompleteProviderFactory[] = [];
  const uiContext: ExtensionUIContext = {
    // Keep Pi's real no-op UI behavior and observe the two calls these tests assert on.
    ...session.extensionRunner.getUIContext(),
    notify: (message, type) => {
      notifications.push({ message, type });
    },
    addAutocompleteProvider: (factory) => {
      autocompleteFactories.push(factory);
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
    autocompleteFactories,
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

async function waitForStreaming(session: AgentSession): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (session.isStreaming) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Pi session did not start streaming against the local model server");
}

describe("real skill discovery and command registration", () => {
  it("discovers skills on disk and exposes them as real skill commands", async () => {
    const codeReviewPath = await writeSkill("code-review", "code-review", "Review the code.");
    await writeSkill("tdd", "tdd", "Write the test first.");
    await writePromptTemplate("review");

    const { loader, commands, skills } = await startSession();

    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(
      loader
        .getSkills()
        .skills.map((skill) => skill.name)
        .sort(),
    ).toEqual(["code-review", "tdd"]);

    const byName = new Map(commands.map((command) => [command.name, command]));
    const loadedCodeReview = loader
      .getSkills()
      .skills.find((skill) => skill.name === "code-review");
    expect(byName.get("skill:code-review")?.source).toBe("skill");
    expect(byName.get("skill:code-review")?.sourceInfo.path).toBe(codeReviewPath);
    expect(byName.get("skill:code-review")?.sourceInfo.baseDir).toBe(
      loadedCodeReview?.sourceInfo.baseDir,
    );
    expect(byName.get("skill:tdd")?.source).toBe("skill");
    expect(byName.get("probe-command")?.source).toBe("extension");
    expect(byName.get("review")?.source).toBe("prompt");

    expect([...skills.keys()].sort()).toEqual(["code-review", "tdd"]);
    expect(getSkill(skills, "code-review").filePath).toBe(codeReviewPath);
  });

  it("collects skill commands and ignores the real extension and prompt commands", async () => {
    await writeSkill("code-review", "code-review", "Review the code.");
    await writePromptTemplate("review");

    const { commands } = await startSession();
    const skills = skillsFromCommands(commands);

    expect([...skills.keys()]).toEqual(["code-review"]);
    expect(commands.some((command) => command.source === "extension")).toBe(true);
    expect(commands.some((command) => command.source === "prompt")).toBe(true);
  });
});

describe("expandSkillTokens", () => {
  it("expands a leading $skill token", async () => {
    await writeSkill("code-review", "code-review", "Review the code carefully.");
    const { skills } = await startSession();
    const skill = getSkill(skills, "code-review");

    const { text, expanded } = await expandSkillTokens("$code-review 最近的改动", skills);

    expect(expanded).toEqual(["code-review"]);
    expect(text).toBe(
      `<skill name="code-review" location="${skill.filePath}">\n` +
        `References are relative to ${skill.baseDir}.\n\n` +
        `Review the code carefully.\n</skill> 最近的改动`,
    );
  });

  it("expands a token mid-sentence", async () => {
    await writeSkill("reviewer", "code-review", "Do the review.");
    const { skills } = await startSession();

    const { text, expanded } = await expandSkillTokens(
      "使用 $code-review 这个 skill review 代码",
      skills,
    );

    expect(expanded).toEqual(["code-review"]);
    expect(text).toContain('<skill name="code-review"');
    expect(text).toMatch(/^使用 <skill[\s\S]+<\/skill> 这个 skill review 代码$/);
  });

  it("expands multiple different skills", async () => {
    await writeSkill("a-skill", "a-skill", "Body A.");
    await writeSkill("b-skill", "b-skill", "Body B.");
    const { skills } = await startSession();

    const { text, expanded, blocks } = await expandSkillTokens("先 $a-skill 再 $b-skill", skills);

    expect(expanded).toEqual(["a-skill", "b-skill"]);
    expect(blocks.map((block) => block.name)).toEqual(["a-skill", "b-skill"]);
    expect(text).toContain("Body A.");
    expect(text).toContain("Body B.");
    expect(text.indexOf("Body A.")).toBeLessThan(text.indexOf("Body B."));
  });

  it("leaves unknown tokens and prices untouched", async () => {
    await writeSkill("known", "known", "Known.");
    const { skills } = await startSession();

    const input = "成本 $9.99，变量 $HOME，未知 $nosuch，已知 $known";
    const { text, expanded } = await expandSkillTokens(input, skills);

    expect(expanded).toEqual(["known"]);
    expect(text).toContain("$9.99");
    expect(text).toContain("$HOME");
    expect(text).toContain("$nosuch");
    expect(text).not.toContain("$known");
  });

  it("keeps $$name literal as an escape", async () => {
    await writeSkill("esc", "esc", "Escaped?");
    const { skills } = await startSession();

    const { text, expanded } = await expandSkillTokens("字面量 $$esc 不是调用", skills);

    expect(expanded).toEqual([]);
    expect(text).toBe("字面量 $$esc 不是调用");
  });

  it("reports a missing skill file as failed and leaves the token", async () => {
    await writeSkill("gone", "gone", "Soon gone.");
    const { skills } = await startSession();
    const missing = getSkill(skills, "gone");
    await unlink(missing.filePath);

    const { text, expanded, failed } = await expandSkillTokens("试试 $gone", skills);

    expect(expanded).toEqual([]);
    expect(failed).toEqual(["gone"]);
    expect(text).toBe("试试 $gone");
  });
});

describe("skill autocomplete provider", () => {
  const signal = new AbortController().signal;

  async function providerFor(...names: string[]) {
    for (const [index, name] of names.entries()) {
      await writeSkill(`skill-${index}`, name, `Body for ${name}.`);
    }
    const { skills } = await startSession();
    const current = new CombinedAutocompleteProvider(undefined, workDir);
    return {
      current,
      provider: createSkillAutocompleteProvider(current, () => skills),
    };
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
    const cases: Array<[string[], number]> = [
      [["hello"], 5],
      [["echo $HO"], 8],
      [["$zz"], 3],
    ];

    for (const [lines, cursorCol] of cases) {
      const delegated = await current.getSuggestions(lines, 0, cursorCol, { signal });
      expect(await provider.getSuggestions(lines, 0, cursorCol, { signal })).toEqual(delegated);
    }
  });

  it("does not complete `$$name` escape", async () => {
    const { current, provider } = await providerFor("code-review");
    expect(await provider.getSuggestions(["$$code"], 0, 6, { signal })).toEqual(
      await current.getSuggestions(["$$code"], 0, 6, { signal }),
    );
    expect(await provider.getSuggestions(["a $$"], 0, 4, { signal })).toEqual(
      await current.getSuggestions(["a $$"], 0, 4, { signal }),
    );
  });

  it("delegates when no skills are loaded", async () => {
    const { current, provider } = await providerFor();
    expect(await provider.getSuggestions(["$code"], 0, 5, { signal })).toEqual(
      await current.getSuggestions(["$code"], 0, 5, { signal }),
    );
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
    const { current, provider } = await providerFor();
    const expected = current.applyCompletion(
      ["/skil"],
      0,
      5,
      { value: "skill:x", label: "skill:x" },
      "/skil",
    );
    expect(
      provider.applyCompletion(["/skil"], 0, 5, { value: "skill:x", label: "skill:x" }, "/skil"),
    ).toEqual(expected);
  });
});

describe("input handler", () => {
  it("injects a known skill as its own context message", async () => {
    const skillPath = await writeSkill("code-review", "code-review", "Review it.");
    const { session, notifications } = await startSession();

    const result = await session.extensionRunner.emitInput(
      "使用 $code-review 这个 skill review 代码",
      undefined,
      "interactive",
    );

    expect(result).toEqual({ action: "continue" });
    expect(session.messages).toHaveLength(1);
    const [custom] = customMessages(session);
    expect(custom).toMatchObject({
      role: "custom",
      customType: SKILL_MESSAGE_TYPE,
      display: true,
      details: { name: "code-review" },
    });
    expect(custom?.content).toContain(`<skill name="code-review" location="${skillPath}">`);
    expect(custom?.content).toContain("Review it.");
    expect(notifications).toEqual([]);
  });

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

  it("uses the input's delivery mode while the agent is streaming", async () => {
    const baseUrl = await startLocalModelServer();
    await writeModelsFile(baseUrl);
    await writeSkill("known", "known", "Known.");
    const { session } = await startSession();
    expect(session.model?.provider).toBe("local-test");

    const turn = session.prompt("hello").catch((error: unknown) => error);
    await waitForStreaming(session);

    const result = await session.extensionRunner.emitInput(
      "$known",
      undefined,
      "interactive",
      "followUp",
    );
    expect(result).toEqual({ action: "continue" });
    // Pi's follow-up queue is what receives the custom message; steering would not.
    session.agent.clearSteeringQueue();
    expect(session.agent.hasQueuedMessages()).toBe(true);
    session.agent.clearFollowUpQueue();

    session.abort();
    await turn;
  });

  it("registers a renderer for standalone skill messages", async () => {
    const { session } = await startSession();
    expect(session.extensionRunner.getMessageRenderer(SKILL_MESSAGE_TYPE)).toBeTypeOf("function");
  });

  it("registers the skill autocomplete provider on session start", async () => {
    await writeSkill("known", "known", "Known.");
    const { autocompleteFactories } = await startSession();
    expect(autocompleteFactories).toHaveLength(1);
    const [factory] = autocompleteFactories;
    if (!factory) throw new Error("Pi did not receive an autocomplete provider factory");

    const provider = factory(new CombinedAutocompleteProvider(undefined, workDir));
    const result = await provider.getSuggestions(["$"], 0, 1, {
      signal: new AbortController().signal,
    });
    expect(result?.items.map((item) => item.value)).toEqual(["$known"]);
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

  it("does nothing when no skills are loaded", async () => {
    const { session } = await startSession();
    expect(
      await session.extensionRunner.emitInput("$code-review 一下", undefined, "interactive"),
    ).toEqual({ action: "continue" });
    expect(session.messages).toEqual([]);
  });
});

/** Start a real HTTP endpoint that holds the stream open; the real fetch client calls it. */
async function startLocalModelServer(): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  activeServer = server;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local model server did not bind a TCP port");
  }
  return `http://127.0.0.1:${address.port}/v1`;
}

async function writeModelsFile(baseUrl: string): Promise<void> {
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "local-test": {
          baseUrl,
          api: "openai-completions",
          apiKey: "local-test-key",
          models: [{ id: "local-test-model" }],
        },
      },
    }),
  );
}
