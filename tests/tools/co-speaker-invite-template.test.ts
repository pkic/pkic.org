/**
 * The invitation an added speaker receives from the canonical template seeder: who
 * proposed them, the session's title and abstract, that they take part only
 * once they accept, and the link to accept or decline. Rendered by the same
 * engine the outbox uses, from the seeded template itself.
 */
import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";

function seededBody(): string {
  const template = DEFAULT_TEMPLATES.find((candidate) => candidate.key === "co_speaker_invite");
  expect(template).toBeDefined();
  return template!.content;
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
    expect(rendered).toContain('href="https://pkic.org/events/2026/pqc-2026/propose/speaker/?token=t"');
  });

  it.each([
    [undefined, "The proposer"],
    ["Ada", "Ada"],
  ])("reads naturally without an inviter or abstract, using proposer %s", (proposerFirstName, proposerLabel) => {
    const rendered = compileSimpleTemplate(
      seededBody(),
      {
        eventName: "PQC 2026",
        proposerFirstName,
        proposalTitle: "Post-Quantum Migration Strategies",
        manageUrl: "https://pkic.org/x",
      },
      "markdown",
    );
    expect(rendered).toContain("Dear Speaker,");
    expect(rendered).toContain(`${proposerLabel} has proposed a session for **PQC 2026**`);
    expect(rendered).not.toContain("Speakers on this proposal");
  });
});
