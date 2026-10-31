import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { buildTemplateSqlStatements } from "../../scripts/lib/email-template-seed-sql.mjs";
import { REQUIRED_EMAIL_TEMPLATE_KEYS } from "../../functions/_lib/email/required-templates";

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = join(root, "migrations");
const required = new Set<string>(REQUIRED_EMAIL_TEMPLATE_KEYS);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Literal template keys the Worker sends: `templateKey: "…"` (both branches of a ternary), `…_TEMPLATE… = "…"`
 * constants, `template_key = '…'` SQL, and outbox rows inserted straight from SQL.
 */
function referencedTemplateKeys(): Map<string, string> {
  const references = new Map<string, string>();
  const note = (key: string, file: string) => {
    if (!references.has(key)) references.set(key, relative(root, file));
  };
  for (const file of sourceFiles(join(root, "functions"))) {
    const source = readFileSync(file, "utf8");
    for (const [, expression] of source.matchAll(/\btemplateKey\s*[:=]\s*([^,;\n]+)/g))
      for (const [, key] of expression!.matchAll(/(?:^|[?:])\s*["']([a-z][a-z0-9_-]+)["']/g)) note(key!, file);
    for (const [, key] of source.matchAll(/_TEMPLATE\w*\s*=\s*["']([a-z][a-z0-9_-]+)["']/g)) note(key!, file);
    for (const [, key] of source.matchAll(/\btemplate_key\s*=\s*'([a-z][a-z0-9_-]+)'/g)) note(key!, file);
    for (const [, key] of source.matchAll(/["'](partial_[a-z_]+)["']/g)) note(key!, file);
    for (const [, statement] of source.matchAll(/INSERT INTO email_outbox\b([^`]+)`/g))
      // The template key follows the event id, bound or selected.
      for (const [, key] of statement!.matchAll(/(?:\?|\w+\.event_id),\s*'([a-z][a-z0-9_-]+)',/g)) note(key!, file);
  }
  return references;
}

/** Every environment's catalog: the full migration chain, then the template seed in its default missing-only mode. */
function seededCatalog(): Map<string, string | null> {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(migrationDirectory)
      .filter((name) => /^\d.*\.sql$/.test(name))
      .sort())
      db.exec(readFileSync(join(migrationDirectory, name), "utf8"));
    db.exec(`INSERT INTO users (id, email, normalized_email, created_at, updated_at)
      VALUES ('seed-admin', 'admin@example.test', 'admin@example.test',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    db.exec(buildTemplateSqlStatements({ adminEmail: "admin@example.test", ifMissing: true }, DEFAULT_TEMPLATES));
    const rows = db.prepare("SELECT template_key, body FROM email_template_versions WHERE status = 'active'").all() as {
      template_key: string;
      body: string | null;
    }[];
    return new Map(rows.map((row) => [row.template_key, row.body]));
  } finally {
    db.close();
  }
}

describe("templates the platform sends from code", () => {
  it("lists every template key the Worker references", () => {
    const unlisted = [...referencedTemplateKeys()]
      .filter(([key]) => !required.has(key))
      .map(([key, file]) => `${key} (${file})`);
    expect(unlisted).toEqual([]);
  });

  it("lists no key the Worker no longer references", () => {
    const referenced = referencedTemplateKeys();
    expect(REQUIRED_EMAIL_TEMPLATE_KEYS.filter((key) => !referenced.has(key))).toEqual([]);
  });

  it("provides an active template with a body for every required key from the migrations and the seed", () => {
    const catalog = seededCatalog();
    expect(REQUIRED_EMAIL_TEMPLATE_KEYS.filter((key) => !catalog.get(key)?.trim())).toEqual([]);
  });
});
