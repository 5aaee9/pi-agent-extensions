// Extracts the exact `## <version>` section from a CHANGELOG.md.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,2})\s+(.*?)\s*#*\s*$/;

/**
 * Returns `{ ok: true, body }` for exactly one non-empty `## <version>` section,
 * or `{ ok: false, reason }` when it is missing, duplicated, or empty. Headings
 * that carry anything after the version (such as a date) do not match, and
 * headings inside fenced code blocks are ignored.
 */
export function findChangelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current;
  let fence;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = undefined;
      }
      current?.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      current?.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      current = undefined;
      if (heading[1] === "##" && heading[2] === version) {
        current = [];
        sections.push(current);
      }
      continue;
    }
    current?.push(line);
  }

  if (sections.length === 0) {
    return { ok: false, reason: `CHANGELOG.md has no "## ${version}" section` };
  }
  if (sections.length > 1) {
    return { ok: false, reason: `CHANGELOG.md has ${sections.length} "## ${version}" sections` };
  }
  const body = sections[0].join("\n").trim();
  if (!body) {
    return { ok: false, reason: `CHANGELOG.md has an empty "## ${version}" section` };
  }
  return { ok: true, body: `${body}\n` };
}
