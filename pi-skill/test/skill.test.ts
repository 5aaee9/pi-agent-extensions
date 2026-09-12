import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  MessageRenderer,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import piSkill, {
  createSkillAutocompleteProvider,
  expandSkillTokens,
  skillsFromCommands,
  SKILL_MESSAGE_TYPE,
  type SkillRef,
} from "../index.ts";

type InputHandler = (
  event: InputEvent,
  ctx: ExtensionContext,
) => Promise<InputEventResult | undefined>;

let workDir: string;
let notifications: Array<{ message: string; level: string }>;
let sentMessages: Array<{
  message: Parameters<ExtensionAPI["sendMessage"]>[0];
  options: Parameters<ExtensionAPI["sendMessage"]>[1];
}>;
let messageRenderers: Map<string, MessageRenderer>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pi-skill-test-"));
  notifications = [];
  sentMessages = [];
  messageRenderers = new Map();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeSkill(dirName: string, name: string, body: string): Promise<SkillRef> {
  const dir = join(workDir, dirName);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "SKILL.md");
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n${body}\n`,
  );
  return { name, filePath, baseDir: dir, description: `Test skill ${name}` };
}

function skillCommand(skill: SkillRef): SlashCommandInfo {
  return {
    name: `skill:${skill.name}`,
    description: `Test skill ${skill.name}`,
    source: "skill",
    sourceInfo: {
      path: skill.filePath,
      source: "test",
      scope: "user",
      origin: "top-level",
      baseDir: skill.baseDir,
    },
  };
}

function createHarness(commands: SlashCommandInfo[]) {
  const handlers = new Map<string, InputHandler[]>();
  const pi = {
    on: (event: string, handler: InputHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    getCommands: () => commands,
    registerMessageRenderer: (customType: string, renderer: MessageRenderer) => {
      messageRenderers.set(customType, renderer);
    },
    sendMessage: (
      message: Parameters<ExtensionAPI["sendMessage"]>[0],
      options: Parameters<ExtensionAPI["sendMessage"]>[1],
    ) => {
      sentMessages.push({ message, options });
    },
  } as unknown as ExtensionAPI;

  piSkill(pi);

  const ctx = {
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionContext;

  const emit = async (
    text: string,
    streamingBehavior?: InputEvent["streamingBehavior"],
  ): Promise<InputEventResult | undefined> => {
    const event: InputEvent = {
      type: "input",
      text,
      source: "interactive",
      streamingBehavior,
    };
    let result: InputEventResult | undefined;
    for (const handler of handlers.get("input") ?? []) {
      const r = await handler(event, ctx);
      if (r) result = r;
    }
    return result;
  };

  return { emit };
}

describe("skillsFromCommands", () => {
  it("collects skill commands and ignores other sources", async () => {
    const skill = await writeSkill("code-review", "code-review", "Review the code.");
    const commands: SlashCommandInfo[] = [
      skillCommand(skill),
      {
        name: "continue",
        description: "Extension command",
        source: "extension",
        sourceInfo: { path: "/ext/index.ts", source: "test", scope: "user", origin: "top-level" },
      },
      {
        name: "template",
        description: "Prompt template",
        source: "prompt",
        sourceInfo: { path: "/tpl.md", source: "test", scope: "user", origin: "top-level" },
      },
    ];

    const skills = skillsFromCommands(commands);
    expect(skills.size).toBe(1);
    expect(skills.get("code-review")).toEqual(skill);
  });
});

describe("expandSkillTokens", () => {
  it("expands a leading $skill token", async () => {
    const skill = await writeSkill("code-review", "code-review", "Review the code carefully.");
    const skills = new Map([[skill.name, skill]]);

    const { text, expanded } = await expandSkillTokens("$code-review 最近的改动", skills);

    expect(expanded).toEqual(["code-review"]);
    expect(text).toBe(
      `<skill name="code-review" location="${skill.filePath}">\n` +
        `References are relative to ${skill.baseDir}.\n\n` +
        `Review the code carefully.\n</skill> 最近的改动`,
    );
  });

  it("expands a token mid-sentence", async () => {
    const skill = await writeSkill("reviewer", "code-review", "Do the review.");
    const skills = new Map([[skill.name, skill]]);

    const { text, expanded } = await expandSkillTokens(
      "使用 $code-review 这个 skill review 代码",
      skills,
    );

    expect(expanded).toEqual(["code-review"]);
    expect(text).toContain('<skill name="code-review"');
    expect(text).toMatch(/^使用 <skill[\s\S]+<\/skill> 这个 skill review 代码$/);
  });

  it("expands multiple different skills", async () => {
    const a = await writeSkill("a-skill", "a-skill", "Body A.");
    const b = await writeSkill("b-skill", "b-skill", "Body B.");
    const skills = new Map([
      [a.name, a],
      [b.name, b],
    ]);

    const { text, expanded, blocks } = await expandSkillTokens("先 $a-skill 再 $b-skill", skills);

    expect(expanded).toEqual(["a-skill", "b-skill"]);
    expect(blocks.map((block) => block.name)).toEqual(["a-skill", "b-skill"]);
    expect(text).toContain("Body A.");
    expect(text).toContain("Body B.");
    expect(text.indexOf("Body A.")).toBeLessThan(text.indexOf("Body B."));
  });

  it("leaves unknown tokens and prices untouched", async () => {
    const skill = await writeSkill("known", "known", "Known.");
    const skills = new Map([[skill.name, skill]]);

    const input = "成本 $9.99，变量 $HOME，未知 $nosuch，已知 $known";
    const { text, expanded } = await expandSkillTokens(input, skills);

    expect(expanded).toEqual(["known"]);
    expect(text).toContain("$9.99");
    expect(text).toContain("$HOME");
    expect(text).toContain("$nosuch");
    expect(text).not.toContain("$known");
  });

  it("keeps $$name literal as an escape", async () => {
    const skill = await writeSkill("esc", "esc", "Escaped?");
    const skills = new Map([[skill.name, skill]]);

    const { text, expanded } = await expandSkillTokens("字面量 $$esc 不是调用", skills);

    expect(expanded).toEqual([]);
    expect(text).toBe("字面量 $$esc 不是调用");
  });

  it("reports a missing skill file as failed and leaves the token", async () => {
    const missing: SkillRef = {
      name: "gone",
      filePath: join(workDir, "gone", "SKILL.md"),
      baseDir: join(workDir, "gone"),
    };
    const skills = new Map([[missing.name, missing]]);

    const { text, expanded, failed } = await expandSkillTokens("试试 $gone", skills);

    expect(expanded).toEqual([]);
    expect(failed).toEqual(["gone"]);
    expect(text).toBe("试试 $gone");
  });
});

describe("skill autocomplete provider", () => {
  const fallbackSuggestions: AutocompleteSuggestions = {
    prefix: "x",
    items: [{ value: "x", label: "x" }],
  };

  function fakeCurrent(): AutocompleteProvider {
    return {
      getSuggestions: async () => fallbackSuggestions,
      applyCompletion: () => ({
        lines: ["fallback"],
        cursorLine: 0,
        cursorCol: 8,
      }),
    };
  }

  function skillMap(...names: string[]): Map<string, SkillRef> {
    return new Map(
      names.map((name) => [
        name,
        {
          name,
          filePath: `/skills/${name}/SKILL.md`,
          baseDir: `/skills/${name}`,
          description: `Test skill ${name}`,
        },
      ]),
    );
  }

  const signal = new AbortController().signal;

  it("suggests all skills right after `$`", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () =>
      skillMap("code-review", "tdd"),
    );
    const result = await provider.getSuggestions(["使用 $"], 0, 4, { signal });
    expect(result?.prefix).toBe("$");
    expect(result?.items.map((i) => i.value).sort()).toEqual(["$code-review", "$tdd"]);
    expect(result?.items[0]?.description).toContain("Test skill");
  });

  it("filters by typed prefix", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () =>
      skillMap("code-review", "tdd", "codebase-design"),
    );
    const result = await provider.getSuggestions(["$code"], 0, 5, { signal });
    expect(result?.prefix).toBe("$code");
    expect(result?.items.map((i) => i.value).sort()).toEqual(["$code-review", "$codebase-design"]);
  });

  it("delegates when there is no `$` token or no match", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => skillMap("code-review"));
    // No $ at all
    expect(await provider.getSuggestions(["hello"], 0, 5, { signal })).toBe(fallbackSuggestions);
    // $HOME style: not a skill name char after $ → pattern still matches "HOME"? No: [a-z0-9-] excludes uppercase.
    expect(await provider.getSuggestions(["echo $HO"], 0, 8, { signal })).toBe(fallbackSuggestions);
    // Unknown skill name → no items → fallback
    expect(await provider.getSuggestions(["$zz"], 0, 3, { signal })).toBe(fallbackSuggestions);
  });

  it("does not complete `$$name` escape", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => skillMap("code-review"));
    expect(await provider.getSuggestions(["$$code"], 0, 6, { signal })).toBe(fallbackSuggestions);
    expect(await provider.getSuggestions(["a $$"], 0, 4, { signal })).toBe(fallbackSuggestions);
  });

  it("delegates when no skills are loaded", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => new Map());
    expect(await provider.getSuggestions(["$code"], 0, 5, { signal })).toBe(fallbackSuggestions);
  });

  it("replaces the $ prefix and adds a trailing space on applyCompletion", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => new Map());
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
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => new Map());
    const lines = ["$cod"];
    const result = provider.applyCompletion(
      lines,
      0,
      4,
      { value: "$code-review", label: "$code-review" },
      "$cod",
    );
    expect(result.lines[0]).toBe("$code-review ");
    expect(result.cursorCol).toBe("$code-review".length + 1);
  });

  it("delegates applyCompletion for non-$ prefixes", async () => {
    const provider = createSkillAutocompleteProvider(fakeCurrent(), () => new Map());
    const result = provider.applyCompletion(
      ["/skil"],
      0,
      5,
      { value: "skill:x", label: "skill:x" },
      "/skil",
    );
    expect(result.lines[0]).toBe("fallback");
  });
});

describe("input handler", () => {
  it("injects a known skill as its own context message", async () => {
    const skill = await writeSkill("code-review", "code-review", "Review it.");
    const { emit } = createHarness([skillCommand(skill)]);

    const result = await emit("使用 $code-review 这个 skill review 代码");

    expect(result).toEqual({ action: "continue" });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toMatchObject({
      customType: SKILL_MESSAGE_TYPE,
      display: true,
      details: { name: "code-review" },
    });
    expect(sentMessages[0]?.message.content).toContain(
      `<skill name="code-review" location="${skill.filePath}">`,
    );
    expect(sentMessages[0]?.message.content).toContain("Review it.");
    expect(sentMessages[0]?.options).toBeUndefined();
    expect(notifications).toEqual([]);
  });

  it("injects one message per distinct skill in first-reference order", async () => {
    const a = await writeSkill("a-skill", "a-skill", "Body A.");
    const b = await writeSkill("b-skill", "b-skill", "Body B.");
    const { emit } = createHarness([skillCommand(a), skillCommand(b)]);

    await emit("先 $a-skill，再 $b-skill，最后仍用 $a-skill");

    expect(sentMessages.map(({ message }) => message.details)).toEqual([
      { name: "a-skill" },
      { name: "b-skill" },
    ]);
  });

  it("uses the input's delivery mode while the agent is streaming", async () => {
    const skill = await writeSkill("known", "known", "Known.");
    const { emit } = createHarness([skillCommand(skill)]);

    await emit("$known", "followUp");

    expect(sentMessages[0]?.options).toEqual({ deliverAs: "followUp" });
  });

  it("registers a renderer for standalone skill messages", () => {
    createHarness([]);
    expect(messageRenderers.has(SKILL_MESSAGE_TYPE)).toBe(true);
  });

  it("passes through input without $ or without matching skills", async () => {
    const skill = await writeSkill("known", "known", "Known.");
    const { emit } = createHarness([skillCommand(skill)]);

    expect(await emit("普通消息")).toBeUndefined();
    expect(await emit("价格是 $100")).toBeUndefined();
    expect(sentMessages).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("does nothing when no skills are loaded", async () => {
    const { emit } = createHarness([]);
    expect(await emit("$code-review 一下")).toBeUndefined();
    expect(sentMessages).toEqual([]);
  });
});
