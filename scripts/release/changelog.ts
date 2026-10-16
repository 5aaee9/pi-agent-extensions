// Extracts the `## <version>` section from a CHANGELOG.md.

const FENCE = /^\s{0,3}(?<marker>`{3,}|~{3,})/u;
const HEADING = /^(?<level>#{1,2})\s+(?<text>.*?)\s*#*\s*$/u;
/** `## <version>`, optionally carrying the date it was cut, as history does. */
const SECTION = /^(?<version>\S+)(?:\s*[-–—]\s*\d{4}-\d{2}-\d{2})?$/u;

export type ChangelogSection =
  | { readonly ok: true; readonly count: 1; readonly body: string }
  | { readonly ok: false; readonly count: number; readonly reason: string };

/**
 * Returns the body of exactly one non-empty section for `version`, or the reason
 * it is missing, duplicated, or empty (`count` is the number of matching
 * headings). A heading names the version with or without the date it was cut
 * (`## 0.1.44` and `## 0.1.43 - 2026-10-11` both match their own version); any
 * other trailing text does not match, and headings inside fenced code blocks are
 * ignored.
 */
export function findChangelogSection(text: string, version: string): ChangelogSection {
  const sections: string[][] = [];
  let current: string[] | undefined;
  let fence: string | undefined;

  for (const line of text.split(/\r?\n/u)) {
    const marker = FENCE.exec(line)?.groups?.["marker"];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      current?.push(line);
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      current?.push(line);
      continue;
    }
    const heading = HEADING.exec(line)?.groups;
    if (heading !== undefined) {
      current = undefined;
      const headingText = heading["level"] === "##" ? (heading["text"] ?? "") : "";
      if (SECTION.exec(headingText)?.groups?.["version"] === version) {
        current = [];
        sections.push(current);
      }
      continue;
    }
    current?.push(line);
  }

  const [first, ...others] = sections;
  if (first === undefined) {
    return { ok: false, count: 0, reason: `CHANGELOG.md has no "## ${version}" section` };
  }
  if (others.length > 0) {
    return {
      ok: false,
      count: sections.length,
      reason: `CHANGELOG.md has ${sections.length} "## ${version}" sections`,
    };
  }
  const body = first.join("\n").trim();
  if (body === "") {
    return { ok: false, count: 1, reason: `CHANGELOG.md has an empty "## ${version}" section` };
  }
  return { ok: true, count: 1, body: `${body}\n` };
}
