import { describe, expect, it } from "vitest";
import {
  sqlString,
  toSqlNullableText,
  buildUpsertOrganizationStatement,
  buildOrganizationDomainStatements,
  buildOrganizationMemberAggregateStatements,
  buildOrganizationRepresentativeStatement,
  buildRepresentativeRoleGrantStatement,
  buildUpsertUserStatement,
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

describe("buildOrganizationRepresentativeStatement / buildRepresentativeRoleGrantStatement", () => {
  it("targets organization_representatives with the given visibility flag", () => {
    const shown = buildOrganizationRepresentativeStatement("acme corp", "alice@acme.example", true, {
      jobTitle: "Policy lead",
      biography: "Organization-specific biography",
      linksJson: '["https://acme.example/alice"]',
    });
    expect(shown).toContain("INSERT INTO organization_representatives");
    expect(shown).toContain("'Policy lead'");
    expect(shown).toContain("'Organization-specific biography'");
    expect(shown).toContain(sqlString('["https://acme.example/alice"]'));
    expect(shown).toMatch(/'migration', 1,/);

    const hidden = buildOrganizationRepresentativeStatement("acme corp", "bare@acme.example", false);
    expect(hidden).toMatch(/'migration', 0,/);
  });

  it("grants a role scoped to context_type='organization'", () => {
    const statement = buildRepresentativeRoleGrantStatement("acme corp", "alice@acme.example", "role-primary_contact");
    expect(statement).toContain("INSERT OR IGNORE INTO user_roles");
    expect(statement).toContain("'organization'");
    expect(statement).toContain(sqlString("role-primary_contact"));
  });
});

describe("buildUpsertUserStatement", () => {
  it("normalizes the email and returns it alongside the statement", () => {
    const { statement, normalizedEmail } = buildUpsertUserStatement({
      email: "Alice@Acme.Example",
      firstName: "Alice",
      lastName: "Anderson",
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    });
    expect(normalizedEmail).toBe("alice@acme.example");
    expect(statement).toContain("INSERT INTO users");
    expect(statement).toContain(sqlString(normalizedEmail));
  });

  it("ends the statement with the CASE...END clause, not a trailing comma after END", () => {
    // Regression test: wrangler's local `d1 execute` SQL statement splitter
    // (unstable_splitSqlQuery) only recognizes a CASE block as closed when
    // END is immediately followed by ";" or whitespace. "END," (comma, no
    // space) desyncs its compound-statement tracking and silently merges
    // every later statement in the file into this one until EOF, eventually
    // failing with D1's 100KB per-statement SQLITE_TOOBIG limit once enough
    // real data has accumulated (confirmed against wrangler's own splitter
    // and against the real 419-org dataset, 2026-08-17). The CASE clause
    // must stay the last clause in the SET list, ending in "END;".
    const { statement } = buildUpsertUserStatement({
      email: "alice@acme.example",
      firstName: null,
      lastName: null,
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    });
    expect(statement.trim()).toMatch(/END;$/);
  });
});

describe("buildIndividualMemberAggregateStatements", () => {
  it("creates an individual-typed aggregate keyed off the user row", () => {
    const statements = buildIndividualMemberAggregateStatements("bob@members.invalid", "H5", null);
    expect(statements[0]).toContain("'individual'");
    expect(statements[0]).toContain("FROM users u WHERE u.normalized_email");
    expect(statements).toHaveLength(3);
  });
});

describe("buildGroupMembershipStatement", () => {
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
