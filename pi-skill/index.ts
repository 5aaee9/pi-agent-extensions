import { readFile } from "node:fs/promises";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";

export interface SkillRef {
  name: string;
  filePath: string;
  baseDir: string;
}

/**
 * Candidates like `$code-review`: a `$` followed by a valid skill name
 * (lowercase letters, digits, single hyphens). `(?<!\$)` keeps `$$name` literal
 * as an escape hatch. Tokens that resolve to no loaded skill pass through
 * untouched, so `$HOME` or `$9.99` in prose are never rewritten.
 */
const SKILL_TOKEN_PATTERN = /(?<!\$)\$([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** Loaded skills register as `skill:<name>` slash commands; their sourceInfo points at SKILL.md. */
export function skillsFromCommands(commands: readonly SlashCommandInfo[]): Map<string, SkillRef> {
  const skills = new Map<string, SkillRef>();
  for (const command of commands) {
    if (command.source !== "skill") continue;
    const name = command.name.startsWith("skill:") ? command.name.slice(6) : command.name;
    const filePath = command.sourceInfo.path;
    if (!filePath) continue;
    skills.set(name, {
      name,
      filePath,
      baseDir: command.sourceInfo.baseDir ?? filePath.replace(/\/[^/]*$/, ""),
    });
  }
  return skills;
}

/**
 * Expand `$skill-name` tokens into the same `<skill>` block pi emits for `/skill:name`.
 * Tokens without a matching loaded skill are left untouched.
 */
export async function expandSkillTokens(
  text: string,
  skills: ReadonlyMap<string, SkillRef>,
): Promise<{ text: string; expanded: string[]; failed: string[] }> {
  const matches = [...text.matchAll(SKILL_TOKEN_PATTERN)];
  if (matches.length === 0) return { text, expanded: [], failed: [] };

  const expanded: string[] = [];
  const failed: string[] = [];

  // Rebuild the string so each match is replaced exactly once, left to right.
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const name = match[1];
    const skill = skills.get(name);
    if (!skill || match.index === undefined) continue;

    let block: string;
    try {
      const content = await readFile(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    } catch {
      failed.push(name);
      continue;
    }

    result += text.slice(cursor, match.index);
    result += block;
    cursor = match.index + match[0].length;
    if (!expanded.includes(name)) expanded.push(name);
  }

  if (expanded.length === 0) return { text, expanded, failed };
  result += text.slice(cursor);
  return { text: result, expanded, failed };
}

export default function piSkill(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (!event.text.includes("$")) return;

    const skills = skillsFromCommands(pi.getCommands());
    if (skills.size === 0) return;

    const { text, expanded, failed } = await expandSkillTokens(event.text, skills);
    for (const name of failed) {
      ctx.ui.notify(`Failed to read skill "${name}"`, "warning");
    }
    if (expanded.length === 0) return;

    ctx.ui.notify(
      `Expanded skill${expanded.length > 1 ? "s" : ""}: ${expanded.join(", ")}`,
      "info",
    );
    return { action: "transform", text };
  });
}
