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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillAutocompleteProvider,
  expandSkillTokens,
  SKILL_MESSAGE_TYPE,
  skillsFromCommands,
  type SkillRef,
} from "../index.ts";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

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
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("HOME", rootDir);
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

  const notifications: Notifications["notifications"] = [];
  const autocompleteFactories: AutocompleteProviderFactory[] = [];
  // Boundary: Pi's UI context is the client side of the host's UI port (the
  // terminal in interactive mode, the protocol in RPC mode). Only its `notify`
  // and `addAutocompleteProvider` members — the seams a UI client would render
  // or install — are swapped for recorders; the runner, session, and every
  // other UI member stay Pi's own.
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

/**
 * Resolve once the real session emits `agent_start`. Subscribe before the
 * prompt is sent so the event cannot be missed.
 */
function agentStarted(session: AgentSession, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Pi session did not start a run within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "agent_start") return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
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

  const forced = { signal, force: true };

  /**
   * Files in the working directory that Pi's real file completion offers for
   * the delegated inputs below, so a delegated answer is a non-empty one that
   * the skill provider could never produce itself.
   */
  const workFiles = [
    "hello.md",
    "$HOME-notes.txt",
    "$zz-notes.txt",
    "$$code-notes.md",
    "$code-notes.md",
  ];

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

  it("delegates when no skills are loaded", async () => {
    const { current, provider } = await providerFor();
    const result = await provider.getSuggestions(["$code"], 0, 5, forced);
    expect(values(result)).toEqual(["$code-notes.md"]);
    expect(result).toEqual(await current.getSuggestions(["$code"], 0, 5, forced));
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
    expect(result).toEqual({ lines: ["/skill:code-review "], cursorLine: 0, cursorCol: 19 });
    expect(result).toEqual(current.applyCompletion(["/skil"], 0, 5, item, "/skil"));
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
    const model = await startLocalModelServer();
    await writeModelsFile(model.baseUrl);
    await writeSkill("known", "known", "Known.");
    const { session } = await startSession();
    expect(session.model?.provider).toBe("local-test");

    const started = agentStarted(session);
    const turn = session.prompt("hello");
    await started;
    expect(session.isStreaming).toBe(true);

    const result = await session.extensionRunner.emitInput(
      "$known",
      undefined,
      "interactive",
      "followUp",
    );
    expect(result).toEqual({ action: "continue" });
    // Pi's follow-up queue is what receives the custom message; steering would
    // not. With steering emptied, something must still be queued.
    session.agent.clearSteeringQueue();
    expect(session.agent.hasQueuedMessages()).toBe(true);

    // Let the held reply finish: the agent then runs the queued follow-up, and
    // the second request on the wire carries the skill message it queued.
    model.release();
    await expect(turn).resolves.toBeUndefined();
    expect(model.bodies).toHaveLength(2);
    expect(lastUserText(model.bodies[0])).toBe("hello");
    expect(lastUserText(model.bodies[1])).toMatch(
      /^<skill name="known" [\s\S]*Known\.\n<\/skill>$/,
    );
    expect(
      customMessages(session).map(({ customType, details }) => ({ customType, details })),
    ).toEqual([{ customType: SKILL_MESSAGE_TYPE, details: { name: "known" } }]);
    const reply = session.messages.at(-1);
    expect(reply?.role === "assistant" ? reply.stopReason : reply?.role).toBe("stop");
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

/** The text of the last user message in an OpenAI-compatible request body. */
function lastUserText(body: string | undefined): string | undefined {
  const parsed = JSON.parse(body ?? "{}") as {
    messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  };
  const last = parsed.messages?.filter((message) => message.role === "user").at(-1);
  if (last === undefined) return undefined;
  return typeof last.content === "string"
    ? last.content
    : last.content.map((part) => part.text ?? "").join("");
}

interface LocalModelServer {
  readonly baseUrl: string;
  /** Request bodies in arrival order. */
  readonly bodies: string[];
  /** Let the held first reply finish. */
  release(): void;
}

function completionChunk(delta: Record<string, string>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "local-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "local-test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/**
 * Start a real OpenAI-compatible endpoint the real fetch client calls. The
 * first reply is held open until `release()`, so the session stays streaming;
 * every reply then completes as a normal streamed chat completion.
 */
async function startLocalModelServer(): Promise<LocalModelServer> {
  const bodies: string[] = [];
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const first = bodies.length === 0;
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      void (first ? released : Promise.resolve()).then(() => {
        response.write(completionChunk({ role: "assistant", content: "ok" }, null));
        response.write(completionChunk({}, "stop"));
        response.end("data: [DONE]\n\n");
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  activeServer = server;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local model server did not bind a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    bodies,
    release: () => release(),
  };
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
