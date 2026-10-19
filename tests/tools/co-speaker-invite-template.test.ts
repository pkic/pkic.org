/**
 * The invitation an added speaker receives, as migration 0038 seeds it: who
 * proposed them, the session's title and abstract, that they take part only
 * once they accept, and the link to accept or decline. Rendered by the same
 * engine the outbox uses, from the seeded SQL itself.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";

const MIGRATION = path.resolve("migrations/0038_event_agenda_platform.sql");

function seededBody(): string {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("'template-co-speaker-invite-v2'");
  expect(start).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("'{{#if firstName}}", start) + 1;
  const bodyEnd = sql.indexOf("','markdown'", bodyStart);
  return sql.slice(bodyStart, bodyEnd).replaceAll("''", "'");
}

describe("co-speaker invitation template", () => {
  it("names the proposer and the session and asks the speaker to accept or decline", () => {
    const rendered = compileSimpleTemplate(
      seededBody(),
      {
        firstName: "Co",
        eventName: "PQC 2026",
        invitedByDisplay: "Ada Lovelace (Example Org)",
        proposalTitle: "Post-Quantum Migration Strategies",
        proposalAbstract: "A practical guide to migrating enterprise PKI.",
        speakerLineupText: "- Ada Lovelace (Example Org)",
        manageUrl: "https://pkic.org/events/2026/pqc-2026/propose/speaker/?token=t",
      },
      "markdown",
    );
    expect(rendered).toContain("Dear Co,");
    expect(rendered).toContain("Ada Lovelace (Example Org) has proposed a session for **PQC 2026**");
    expect(rendered).toContain("**Post-Quantum Migration Strategies**");
    expect(rendered).toContain("A practical guide to migrating enterprise PKI.");
    expect(rendered).toContain("only once you accept");
    expect(rendered).toContain("decline");
    expect(rendered).toContain("[Review and respond](https://pkic.org/events/2026/pqc-2026/propose/speaker/?token=t)");
  });

  it("still reads naturally when a reminder has no proposer or abstract to name", () => {
    const rendered = compileSimpleTemplate(
      seededBody(),
      { eventName: "PQC 2026", proposalTitle: "Post-Quantum Migration Strategies", manageUrl: "https://pkic.org/x" },
      "markdown",
    );
    expect(rendered).toContain("Dear Speaker,");
    expect(rendered).toContain("The proposer has proposed a session for **PQC 2026**");
    expect(rendered).not.toContain("Speakers on this proposal");
  });
});
