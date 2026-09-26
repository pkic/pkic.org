import { describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import {
  sqlString,
  toSqlNullableText,
  buildUpsertOrganizationStatement,
  buildOrganizationDomainStatements,
  buildOrganizationMemberAggregateStatements,
  buildActingIdentityStatement,
  buildRepresentativeRoleGrantStatement,
  buildUpsertUserStatements,
  ownerUserIdForEmail,
  buildIndividualMemberAggregateStatements,
  buildGroupMembershipStatement,
  buildLinksJson,
  buildEventSponsorshipStatements,
  buildNonMemberEventSponsorshipStatements,
} from "../../scripts/migrate-members/sql-renderer.mjs";

describe("buildLinksJson", () => {
  it("returns null for an empty or all-invalid list", () => {
    expect(buildLinksJson([])).toBeNull();
    expect(buildLinksJson(null)).toBeNull();
    expect(buildLinksJson(["ttps://x.com/acme", "not-a-url"])).toBeNull();
  });

  it("validates against the canonical linksSchema: rejects non-http(s), drops invalid entries instead of throwing", () => {
    const invalid: string[] = [];
    const result = buildLinksJson(
      ["https://linkedin.com/company/acme", "ttps://x.com/acme", "ftp://bad.example"],
      (url: string) => invalid.push(url),
    );
    expect(result).toBe(JSON.stringify(["https://linkedin.com/company/acme"]));
    expect(invalid).toEqual(["ttps://x.com/acme", "ftp://bad.example"]);
  });

  it("dedupes case-insensitively and caps at 15 entries, reporting both the duplicate and the over-cap entry as invalid", () => {
    const links = Array.from({ length: 16 }, (_, i) => `https://example.com/${i}`);
    links.push("HTTPS://EXAMPLE.COM/0"); // case-insensitive duplicate of the first
    const invalid: string[] = [];
    const result = buildLinksJson(links, (url: string) => invalid.push(url));
    expect(JSON.parse(result as string)).toHaveLength(15);
    expect(invalid).toEqual(["https://example.com/15", "HTTPS://EXAMPLE.COM/0"]);
  });

  it('real production-data regression: a typo\'d protocol ("ttps://" missing the leading h) is dropped, not silently persisted', () => {
    const invalid: string[] = [];
    const result = buildLinksJson(["ttps://x.com/veracruzcerene"], (url: string) => invalid.push(url));
    expect(result).toBeNull();
    expect(invalid).toEqual(["ttps://x.com/veracruzcerene"]);
  });
});

describe("sqlString / toSqlNullableText", () => {
  it("escapes embedded single quotes", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });

  it("renders null/undefined/blank as SQL NULL", () => {
    expect(toSqlNullableText(null)).toBe("NULL");
    expect(toSqlNullableText(undefined)).toBe("NULL");
    expect(toSqlNullableText("   ")).toBe("NULL");
    expect(toSqlNullableText("value")).toBe("'value'");
  });
});

describe("buildUpsertOrganizationStatement", () => {
  it("never references the dropped membership_category/social_* columns, and folds social links into links_json", () => {
    const { statement, normalizedOrgName } = buildUpsertOrganizationStatement({
      slug: "acme",
      name: "Acme Corp",
      doc: { social: { linkedin: "https://linkedin.com/company/acme", x: "https://x.com/acme" } },
      logoR2Key: null,
    });
    expect(normalizedOrgName).toBe("acme corp");
    expect(statement).toContain("INSERT INTO organizations");
    expect(statement).not.toMatch(/membership_category|social_x|social_linkedin|primary_contact_user_id/);
    expect(statement).toContain(sqlString(JSON.stringify(["https://linkedin.com/company/acme", "https://x.com/acme"])));
  });
});

describe("buildOrganizationDomainStatements", () => {
  it("emits one INSERT OR IGNORE per non-blank domain, trimmed and lowercased", () => {
    const statements = buildOrganizationDomainStatements("acme corp", [" Acme.Example ", "", "other.example"]);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT OR IGNORE INTO organization_domain_claims");
    expect(statements[0]).toContain(sqlString("acme.example"));
    expect(statements[1]).toContain(sqlString("other.example"));
  });
});

describe("buildOrganizationMemberAggregateStatements", () => {
  it("creates the aggregate + category assignment, and skips the category insert when categoryCode is falsy", () => {
    const withCategory = buildOrganizationMemberAggregateStatements("acme corp", "A", "2020-01-01");
    expect(withCategory).toHaveLength(3);
    expect(withCategory[0]).toContain("INSERT OR IGNORE INTO members");
    expect(withCategory[0]).toContain("'organization'");
    expect(withCategory[2]).toContain("INSERT OR IGNORE INTO member_category_assignments");

    const withoutCategory = buildOrganizationMemberAggregateStatements("acme corp", null, null);
    expect(withoutCategory).toHaveLength(2);
  });
});

describe("buildActingIdentityStatement / buildRepresentativeRoleGrantStatement", () => {
  it("targets identities with the given visibility flag", () => {
    const shown = buildActingIdentityStatement("acme corp", "alice@acme.example", true, {
      jobTitle: "Policy lead",
      biography: "Organization-specific biography",
      linksJson: '["https://acme.example/alice"]',
    });
    expect(shown).toContain("INSERT INTO identities");
    expect(shown).toContain("'Policy lead'");
    expect(shown).toContain("'Organization-specific biography'");
    expect(shown).toContain(sqlString('["https://acme.example/alice"]'));
    expect(shown).toMatch(/'migration', 1,/);

    const hidden = buildActingIdentityStatement("acme corp", "bare@acme.example", false);
    expect(hidden).toMatch(/'migration', 0,/);
  });

  it("grants a role scoped to context_type='organization'", () => {
    const statement = buildRepresentativeRoleGrantStatement("acme corp", "alice@acme.example", "role-primary_contact");
    expect(statement).toContain("INSERT OR IGNORE INTO user_roles");
    expect(statement).toContain("'organization'");
    expect(statement).toContain(sqlString("role-primary_contact"));
  });
});

describe("ownerUserIdForEmail", () => {
  it("resolves the address through primary and alternate account addresses, skipping closed accounts", () => {
    const resolver = ownerUserIdForEmail("alice@acme.example");
    expect(resolver).toContain("FROM users live");
    expect(resolver).toContain("FROM user_emails alternate");
    expect(resolver.match(/pii_redacted_at IS NULL AND \w+\.merged_into_user_id IS NULL/g)).toHaveLength(2);
    expect(resolver).toContain(sqlString("alice@acme.example"));
  });
});

describe("buildUpsertUserStatements", () => {
  it("normalizes the email and returns it alongside the statements", () => {
    const { statements, normalizedEmail } = buildUpsertUserStatements({
      email: "Alice@Acme.Example",
      firstName: "Alice",
      lastName: "Anderson",
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    });
    expect(normalizedEmail).toBe("alice@acme.example");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT INTO users");
    expect(statements[0]).toContain(sqlString(normalizedEmail));
    expect(statements[1]).toContain("UPDATE users SET");
  });

  it("creates an account only for an address no account has reserved, and never upserts onto the reservation", () => {
    // `trg_users_primary_email_reservation_insert` (consolidated migration
    // 0035) fires before SQLite detects an ON CONFLICT target, so an upsert
    // on an address another account holds — as an alternate address, or as
    // an unconfirmed pending email change — aborts the whole import file
    // with EMAIL_TAKEN. The insert has to be guarded instead.
    const [createAccount] = buildUpsertUserStatements({
      email: "alice@acme.example",
      firstName: null,
      lastName: null,
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    }).statements;
    expect(createAccount).not.toContain("ON CONFLICT");
    expect(createAccount).toContain(
      `SELECT 1 FROM users WHERE normalized_email = ${sqlString("alice@acme.example")} OR pending_email = ${sqlString("alice@acme.example")}`,
    );
    expect(createAccount).toContain(
      `SELECT 1 FROM user_emails WHERE normalized_email = ${sqlString("alice@acme.example")}`,
    );
  });

  it("fills profile gaps on the live account that owns the address, without clobbering hand-set values", () => {
    const [, fillProfileGaps] = buildUpsertUserStatements({
      email: "alice@acme.example",
      firstName: "Alice",
      lastName: null,
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: "member-photos/alice.png",
    }).statements;
    expect(fillProfileGaps).toContain("first_name = COALESCE(first_name, 'Alice')");
    expect(fillProfileGaps).toContain("WHEN headshot_r2_key LIKE 'headshots/%' THEN headshot_r2_key");
    expect(fillProfileGaps).toContain(`WHERE id = ${ownerUserIdForEmail("alice@acme.example")}`);
  });

  it("stays one statement per statement under wrangler's own SQL splitter", () => {
    // Regression test: wrangler's local `d1 execute` SQL statement splitter
    // (unstable_splitSqlQuery) only recognizes a CASE block as closed when
    // END is immediately followed by ";" or whitespace. "END," (comma, no
    // space) desyncs its compound-statement tracking and silently merges
    // every later statement in the file into this one until EOF, eventually
    // failing with D1's 100KB per-statement SQLITE_TOOBIG limit once enough
    // real data has accumulated (confirmed against wrangler's own splitter
    // and against the real 419-org dataset, 2026-08-17). Assert against the
    // splitter itself rather than the shape of the last clause.
    const { statements } = buildUpsertUserStatements({
      email: "alice@acme.example",
      firstName: null,
      lastName: null,
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    });
    const trailing = "INSERT INTO organizations (id, name, normalized_name) VALUES ('o', 'O', 'o');";
    const split = unstable_splitSqlQuery([...statements, trailing].join("\n")) as string[];
    expect(split).toHaveLength(3);
    expect(split[2]).toContain("INSERT INTO organizations");
  });
});

describe("buildIndividualMemberAggregateStatements", () => {
  it("creates an individual-typed aggregate keyed off the user row", () => {
    const statements = buildIndividualMemberAggregateStatements("bob@members.invalid", "H5", null);
    expect(statements[0]).toContain("'individual'");
    expect(statements[0]).toContain(`FROM users u WHERE u.id = ${ownerUserIdForEmail("bob@members.invalid")}`);
    expect(statements).toHaveLength(4);
    expect(statements[3]).toContain("INSERT INTO identities");
    expect(statements[3]).toContain("organization_id IS NULL");
  });
});

describe("buildGroupMembershipStatement", () => {
  it("targets governance groups explicitly without treating the CA roster as a board", () => {
    expect(buildGroupMembershipStatement("board", "alex@example.test", "board")).toContain(
      "group_row.type_key = 'board'",
    );
    expect(buildGroupMembershipStatement("ca", "alex@example.test")).toContain("group_row.type_key = 'working_group'");
  });
  it("uses the canonical capacity projection and final group schema", () => {
    const statement = buildGroupMembershipStatement("ca", "alice@acme.example");
    expect(statement).toContain("active_user_capacities");
    expect(statement).toContain("INSERT OR IGNORE INTO group_memberships");
    expect(statement).toContain("JOIN groups group_row");
    expect(statement).toContain("'migration'");
    expect(statement).not.toMatch(/\bworking_group_members\b|\bworking_groups\b/);
  });
});

describe("event sponsorship SQL", () => {
  it("uses the same idempotent event upsert for member and non-member sponsors", () => {
    const alias = {
      slug: "example-event",
      name: "Example Event",
      timezone: "UTC",
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-01T17:00:00Z",
    };
    const memberStatements = buildEventSponsorshipStatements("acme", alias, "gold");
    const nonMemberStatements = buildNonMemberEventSponsorshipStatements("Venue", null, null, alias, "silver");

    expect(memberStatements[0].replace(/'[0-9a-f-]{36}'/, "'<id>'")).toBe(
      nonMemberStatements[0].replace(/'[0-9a-f-]{36}'/, "'<id>'"),
    );
    expect(memberStatements[0]).toContain("ON CONFLICT(slug) DO NOTHING");
  });
});
