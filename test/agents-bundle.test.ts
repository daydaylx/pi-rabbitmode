import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DYNAMIC_ROLE_TOOL_ALLOWLIST } from "../src/orchestration/dynamic-role.ts";
import { RABBIT_BUNDLED_ROLES } from "../src/orchestration/agent-factory.ts";

/**
 * Minimal re-implementation of the one rule this test needs from
 * pi-subagents' real parser (`agents/frontmatter.ts` in the pinned
 * clone): `key: value` lines between `---` markers. Good enough to check
 * our own shipped files are well-formed without depending on that
 * external repo's internals.
 */
function parseSimpleFrontmatter(content: string): Record<string, string> {
  assert.match(content, /^---\n/, "file must start with a --- frontmatter block");
  const end = content.indexOf("\n---", 3);
  assert.notEqual(end, -1, "frontmatter block must be closed with ---");
  const block = content.slice(4, end);
  const frontmatter: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[match[1]!] = value;
  }
  return frontmatter;
}

for (const role of RABBIT_BUNDLED_ROLES) {
  test(`agents/rabbit-${role}.md has valid, read-only frontmatter for "${role}"`, async () => {
    const filePath = fileURLToPath(
      new URL(`../agents/rabbit-${role}.md`, import.meta.url),
    );
    const content = await readFile(filePath, "utf8");
    const frontmatter = parseSimpleFrontmatter(content);

    assert.equal(frontmatter.name, role);
    assert.ok(frontmatter.description && frontmatter.description.length > 0);
    assert.equal(frontmatter.package, "rabbitmode");

    const tools = (frontmatter.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    assert.ok(tools.length > 0, "must declare at least one tool");
    for (const tool of tools) {
      assert.ok(
        (DYNAMIC_ROLE_TOOL_ALLOWLIST as readonly string[]).includes(tool),
        `bundled role "${role}" declares non-read-only tool "${tool}"`,
      );
    }

    const body = content.slice(content.indexOf("\n---", 3) + 4).trim();
    assert.ok(body.length > 100, "body (systemPrompt) should be a real role definition, not a stub");
  });
}
