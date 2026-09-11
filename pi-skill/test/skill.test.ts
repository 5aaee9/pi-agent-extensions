import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import piSkill, { expandSkillTokens, skillsFromCommands, type SkillRef } from "../index.ts";

type InputHandler = (
  event: InputEvent,
  ctx: ExtensionContext,
) => Promise<InputEventResult | undefined>;

let workDir: string;
let notifications: Array<{ message: string; level: string }>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pi-skill-test-"));
  notifications = [];
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
  return { name, filePath, baseDir: dir };
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
  } as unknown as ExtensionAPI;

  piSkill(pi);

  const ctx = {
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionContext;

  const emit = async (text: string): Promise<InputEventResult | undefined> => {
    const event: InputEvent = { type: "input", text, source: "interactive" };
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

    const { text, expanded } = await expandSkillTokens("先 $a-skill 再 $b-skill", skills);

    expect(expanded).toEqual(["a-skill", "b-skill"]);
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

describe("input handler", () => {
  it("transforms input containing a known skill", async () => {
    const skill = await writeSkill("code-review", "code-review", "Review it.");
    const { emit } = createHarness([skillCommand(skill)]);

    const result = await emit("使用 $code-review 这个 skill review 代码");

    expect(result?.action).toBe("transform");
    const text = result?.action === "transform" ? result.text : "";
    expect(text).toContain(`<skill name="code-review" location="${skill.filePath}">`);
    expect(text).toContain("Review it.");
    expect(notifications).toEqual([{ message: "Expanded skill: code-review", level: "info" }]);
  });

  it("passes through input without $ or without matching skills", async () => {
    const skill = await writeSkill("known", "known", "Known.");
    const { emit } = createHarness([skillCommand(skill)]);

    expect(await emit("普通消息")).toBeUndefined();
    expect(await emit("价格是 $100")).toBeUndefined();
    expect(notifications).toEqual([]);
  });

  it("does nothing when no skills are loaded", async () => {
    const { emit } = createHarness([]);
    expect(await emit("$code-review 一下")).toBeUndefined();
  });
});
