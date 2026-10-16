import assert from "node:assert/strict";
import { test } from "node:test";

import { findChangelogSection } from "../changelog.mjs";

const changesetsStyle = `# Changelog

## 0.1.44

### Patch Changes

- Restore the cache hit rate in the custom footer.
  Second line of the same entry.

## 0.1.43 - 2026-10-11

- Older entry.
`;

test("extracts a changesets-style section up to the next version heading", () => {
  assert.deepEqual(findChangelogSection(changesetsStyle, "0.1.44"), {
    ok: true,
    count: 1,
    body: "### Patch Changes\n\n- Restore the cache hit rate in the custom footer.\n  Second line of the same entry.\n",
  });
});

test("a dated legacy heading does not match the bare version", () => {
  const result = findChangelogSection(changesetsStyle, "0.1.43");
  assert.equal(result.ok, false);
  assert.match(result.reason, /no "## 0.1.43" section/);
});

test("a duplicate section is an error", () => {
  const text = "# Changelog\n\n## 0.2.0\n\n- A\n\n## 0.2.0\n\n- B\n";
  const result = findChangelogSection(text, "0.2.0");
  assert.equal(result.ok, false);
  assert.match(result.reason, /2 "## 0.2.0" sections/);
});

test("an empty section is an error", () => {
  const text = "# Changelog\n\n## 0.2.0\n\n\n## 0.1.0\n\n- A\n";
  const result = findChangelogSection(text, "0.2.0");
  assert.equal(result.ok, false);
  assert.match(result.reason, /empty "## 0.2.0" section/);
});

test("headings inside fenced code blocks are ignored", () => {
  const text = [
    "# Changelog",
    "",
    "## 0.2.0",
    "",
    "- Example config:",
    "",
    "  ```md",
    "  ## 0.3.0",
    "  ```",
    "",
    "## 0.1.0",
    "",
    "```",
    "## 0.2.0",
    "```",
    "",
  ].join("\n");
  assert.deepEqual(findChangelogSection(text, "0.2.0"), {
    ok: true,
    count: 1,
    body: "- Example config:\n\n  ```md\n  ## 0.3.0\n  ```\n",
  });
  assert.equal(findChangelogSection(text, "0.3.0").ok, false);
});

test("a missing section is an error", () => {
  assert.equal(findChangelogSection("# Changelog\n", "1.0.0").ok, false);
});
