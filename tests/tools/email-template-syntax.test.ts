/**
 * Every seeded email template speaks the syntax the renderer actually reads.
 *
 * Issue #32 was reported from a sponsor's inbox: the message said
 *
 *   "Your Bronze sponsorship for Digitorus is now active{{#startDate}} as of
 *    2026-09-07T13:34:41.870Z{{/startDate}}."
 *
 * The template had been written in Mustache's section form, `{{#name}}`, and
 * the renderer implements Handlebars' block helpers — `{{#if}}`, `{{#unless}}`
 * and `{{#each}}` — so it did not recognize the tags and printed them. A
 * reader with no template in front of them cannot tell that from a bug in the
 * data.
 *
 * Nothing could have caught it: the templates are seeded SQL, the renderer is
 * TypeScript, and the only thing that joins them is an email nobody reads
 * until a sponsor does. This is that join — every block tag in every seeded
 * template, checked against the small set the renderer opens and closes.
 *
 * It reads the migration text rather than a database because the templates are
 * data in a migration, and `resetDb()` empties the table they land in.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The block helpers `functions/_lib/email/render.ts` opens and closes. */
const SUPPORTED_BLOCKS = new Set(["if", "unless", "each"]);

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

function migrationSources(): Array<{ file: string; text: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((file) => ({ file, text: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/** Every `{{#name` and `{{/name` in the text, with the line it sits on. */
function blockTags(text: string): Array<{ tag: string; name: string; line: number }> {
  const found: Array<{ tag: string; name: string; line: number }> = [];
  const pattern = /\{\{([#/])([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push({
      tag: `{{${match[1]}${match[2]}}}`,
      name: match[2],
      line: text.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

describe("seeded email templates", () => {
  it("open and close only the blocks the renderer implements", () => {
    const offenders: string[] = [];
    for (const { file, text } of migrationSources()) {
      for (const { tag, name, line } of blockTags(text)) {
        if (!SUPPORTED_BLOCKS.has(name)) offenders.push(`${file}:${line} ${tag}`);
      }
    }

    /*
     * The message names the file and line, because the fix is a one-word edit
     * in a migration and the failure is otherwise a hunt through 4,000 lines
     * of SQL. `{{#startDate}}` becomes `{{#if startDate}}`.
     */
    expect(
      offenders,
      `These block tags are not helpers the email renderer implements, so they are printed to the reader verbatim.\n` +
        `Supported: ${[...SUPPORTED_BLOCKS].map((name) => `{{#${name} …}}`).join(", ")}.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("balance every block they open", () => {
    for (const { file, text } of migrationSources()) {
      const depth = new Map<string, number>();
      for (const { name, tag } of blockTags(text)) {
        const open = tag.startsWith("{{#");
        depth.set(name, (depth.get(name) ?? 0) + (open ? 1 : -1));
      }
      for (const [name, remaining] of depth) {
        // An unclosed block swallows the rest of the message; an unopened
        // close is printed. Both reach the reader as damage.
        expect(remaining, `${file} leaves {{#${name}}} unbalanced`).toBe(0);
      }
    }
  });
});
