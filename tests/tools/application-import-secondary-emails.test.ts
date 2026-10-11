import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applicationBackfillFixture } from "../helpers/application-backfill";
import { applicationBackfillSql, sourceId } from "../../scripts/membership-application-import/sql.mjs";
import { databaseArguments } from "../../scripts/membership-application-import/database.mjs";
import { sqlString as quote } from "../../scripts/lib/sql.mjs";

it("links historical primary and secondary emails on fresh D1 while rejecting other identities and preserving replayed records", () => {
  const directory = mkdtempSync(join(tmpdir(), "application-alias-d1-"));
  const { manifest, entry } = applicationBackfillFixture(directory);
  const now = "2026-10-11T00:00:00.000Z";
  const applicant = "33333333-3333-4333-8333-333333333333";
  const other = "44444444-4444-4444-8444-444444444444";
  const redacted = "55555555-5555-4555-8555-555555555555";
  function wrangler(args: string[]) {
    return execFileSync("pnpm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  }
  function query(sql: string) {
    const result = JSON.parse(wrangler([...databaseArguments(manifest), "--command", sql]));
    return result.at(-1).results as Record<string, unknown>[];
  }
  function execute(sql: string) {
    const file = join(directory, "application.sql");
    writeFileSync(file, sql, { mode: 0o600 });
    return wrangler([...databaseArguments(manifest), "--file", file, "--yes"]);
  }
  function application(number: number, email: string, userId: string | null = applicant) {
    return {
      ...entry,
      sourceIssueNumber: number,
      source: {
        ...entry.source,
        issue: {
          ...entry.source.issue,
          id: number,
          number,
          html_url: `https://github.com/pkic/members/issues/${number}`,
        },
      },
      mapping: { ...entry.mapping, applicantEmail: email, applicantUserId: userId },
    };
  }
  try {
    wrangler([
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--env",
      "local",
      "--local",
      "--persist-to",
      directory,
    ]);
    query(`INSERT INTO users (id, email, normalized_email, created_at, updated_at, pii_redacted_at, pending_email) VALUES
      (${quote(manifest.actorUserId)}, 'staff@example.org', 'staff@example.org', ${quote(now)}, ${quote(now)}, NULL, NULL),
      (${quote(applicant)}, 'current@example.org', 'current@example.org', ${quote(now)}, ${quote(now)}, NULL, 'pending@example.org'),
      (${quote(other)}, 'other@example.org', 'other@example.org', ${quote(now)}, ${quote(now)}, NULL, NULL),
      (${quote(redacted)}, 'redacted@example.org', 'redacted@example.org', ${quote(now)}, ${quote(now)}, ${quote(now)}, NULL);
      INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES
      ('alias-verified', ${quote(applicant)}, 'historical@example.org', 'historical@example.org', ${quote(now)}, ${quote(now)}),
      ('alias-unverified', ${quote(applicant)}, 'older@example.org', 'older@example.org', NULL, ${quote(now)}),
      ('alias-other', ${quote(other)}, 'someone-else@example.org', 'someone-else@example.org', ${quote(now)}, ${quote(now)}),
      ('alias-redacted', ${quote(redacted)}, 'redacted-alias@example.org', 'redacted-alias@example.org', ${quote(now)}, ${quote(now)});`);

    const accepted = [
      application(101, "current@example.org"),
      application(135, "historical@example.org"),
      application(103, "older@example.org"),
      application(104, "unlinked@example.org", null),
    ];
    const sql = accepted.map((record) => applicationBackfillSql(manifest, record, now)).join("\n");
    execute(sql);
    expect(
      query("SELECT applicant_email, applicant_user_id FROM member_applications ORDER BY applicant_email"),
    ).toEqual([
      { applicant_email: "current@example.org", applicant_user_id: applicant },
      { applicant_email: "historical@example.org", applicant_user_id: applicant },
      { applicant_email: "older@example.org", applicant_user_id: applicant },
      { applicant_email: "unlinked@example.org", applicant_user_id: null },
    ]);
    // Staff aliases need not have mailbox proof; pending reservations and another person's addresses never match.
    const rejected = [
      application(201, "someone-else@example.org"),
      application(202, "other@example.org"),
      application(203, "unknown@example.org"),
      application(204, "pending@example.org"),
      application(205, "redacted-alias@example.org", redacted),
      application(206, "historical@example.org", "66666666-6666-4666-8666-666666666666"),
    ];
    for (const record of rejected) {
      expect(() => execute(applicationBackfillSql(manifest, record, now))).toThrow();
    }
    const historicalId = quote(sourceId(accepted[1]!.source));
    query(`UPDATE member_applications SET applicant_name = 'Later portal edit' WHERE id = ${historicalId};
      UPDATE application_communications SET body = 'Later note edit' WHERE id = ${quote(sourceId(accepted[1]!.source, "source:0"))};`);
    execute(sql);
    expect(query(`SELECT applicant_name, applicant_email FROM member_applications WHERE id = ${historicalId}`)).toEqual(
      [{ applicant_name: "Later portal edit", applicant_email: "historical@example.org" }],
    );
    expect(
      query(
        `SELECT body FROM application_communications WHERE id = ${quote(sourceId(accepted[1]!.source, "source:0"))}`,
      ),
    ).toEqual([{ body: "Later note edit" }]);
    // Failed guards leave no partial notes/audit; replay creates no duplicates or account/email effects.
    expect(
      query(`SELECT
      (SELECT count(*) FROM member_applications) AS applications,
      (SELECT count(*) FROM application_communications) AS notes,
      (SELECT count(*) FROM audit_log WHERE action = 'member_application_recorded') AS audits,
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM user_emails) AS aliases,
      (SELECT email FROM users WHERE id = ${quote(applicant)}) AS current_email`),
    ).toEqual([{ applications: 4, notes: 12, audits: 4, users: 4, aliases: 4, current_email: "current@example.org" }]);
    expect(query("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
