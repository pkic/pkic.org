/**
 * One rule names a person: the preferred name stands in for the first name,
 * and the last name follows. Staff matching an account to proof read the
 * legal name. The portal's function and the Worker's D1 expression agree.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { personDisplayName, personLegalName, type PersonNameParts } from "../assets/shared/person-display";
import { personDisplayNameSql, personNameSql } from "../functions/_lib/services/people/person-name-sql";
import type { Env } from "../functions/_lib/types";

const db = (env as unknown as Env).DB;

const CASES: Array<[PersonNameParts, string | null]> = [
  [{ firstName: "Robert", lastName: "Smith", preferredName: "Bob" }, "Bob Smith"],
  [{ firstName: "Robert", lastName: "Smith", preferredName: null }, "Robert Smith"],
  [{ firstName: "Robert", lastName: "Smith", preferredName: "  " }, "Robert Smith"],
  [{ firstName: null, lastName: "Smith", preferredName: "Bob" }, "Bob Smith"],
  [{ firstName: "Robert", lastName: null, preferredName: null }, "Robert"],
  [{ firstName: null, lastName: "Smith", preferredName: null }, "Smith"],
  [{ firstName: null, lastName: null, preferredName: null }, null],
];

async function sqlName(parts: PersonNameParts, expression: (alias: string) => string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT ${expression("person")} AS name FROM (SELECT ? AS preferred_name, ? AS first_name, ? AS last_name) person`,
    )
    .bind(parts.preferredName ?? null, parts.firstName ?? null, parts.lastName ?? null)
    .first<{ name: string | null }>();
  return row?.name ?? null;
}

describe("person name", () => {
  it.each(CASES)("names %j as %s in the portal and in D1", async (parts, expected) => {
    expect(personDisplayName(parts, "ada@example.test")).toBe(expected ?? "ada@example.test");
    expect(await sqlName(parts, personNameSql)).toBe(expected);
    expect(await sqlName(parts, (alias) => personDisplayNameSql(alias, "Speaker"))).toBe(expected ?? "Speaker");
  });

  it("gives staff the legal name, never the preferred name", () => {
    expect(personLegalName({ firstName: "Robert", lastName: "Smith", preferredName: "Bob" }, null)).toBe(
      "Robert Smith",
    );
    expect(personLegalName({ firstName: null, lastName: null, preferredName: "Bob" }, "bob@example.test")).toBe(
      "bob@example.test",
    );
  });

  it("escapes a fallback that holds a quote", async () => {
    expect(await sqlName({}, (alias) => personDisplayNameSql(alias, "O'Brien"))).toBe("O'Brien");
  });
});
