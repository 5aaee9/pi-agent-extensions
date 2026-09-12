import { readFile } from "node:fs/promises";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";

export interface SkillRef {
  name: string;
  filePath: string;
  baseDir: string;
  description?: string;
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
      description: command.description,
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

const MAX_SUGGESTIONS = 20;

/** Token before the cursor that opens a `$skill` completion: `$` at line start or after whitespace, never `$$`. */
const SKILL_COMPLETION_PATTERN = /(?:^|[\s])\$([a-z0-9-]*)$/;

export function createSkillAutocompleteProvider(
  current: AutocompleteProvider,
  getSkills: () => ReadonlyMap<string, SkillRef>,
): AutocompleteProvider {
  return {
    triggerCharacters: ["$"],

    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = beforeCursor.match(SKILL_COMPLETION_PATTERN);
      // A second `$` just before the token means the user typed `$$name` (literal escape).
      if (!match || beforeCursor.endsWith("$$" + match[1])) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const skills = getSkills();
      if (options.signal.aborted || skills.size === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const query = match[1];
      const refs = [...skills.values()];
      const candidates = query ? fuzzyFilter(refs, query, (skill) => skill.name) : refs;
      const items: AutocompleteItem[] = candidates.slice(0, MAX_SUGGESTIONS).map((skill) => ({
        value: `$${skill.name}`,
        label: `$${skill.name}`,
        description: skill.description,
      }));

      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      return { prefix: `$${query}`, items };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!prefix.startsWith("$")) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const line = lines[cursorLine] ?? "";
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      // Add a separating space only when one isn't already after the cursor.
      const separator = /^\s/.test(afterCursor) ? "" : " ";
      const newLine = `${beforePrefix + item.value + separator}${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + separator.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function piSkill(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) =>
      createSkillAutocompleteProvider(current, () => skillsFromCommands(pi.getCommands())),
    );
  });

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
