/**
 * The invitation an added speaker receives from the canonical template seeder: who
 * proposed them, the session's title and abstract, that willingness does not guarantee a program place,
 * and the link to confirm or decline. Rendered by the same
 * engine the outbox uses, from the seeded template itself.
 */
import { describe, expect, it } from "vitest";
import { compileSeededBody } from "./helpers/seeded-email-partials";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";

function seededBody(): string {
  const template = DEFAULT_TEMPLATES.find((candidate) => candidate.key === "co_speaker_invite");
  expect(template).toBeDefined();
  return template!.content;
}

describe("co-speaker invitation template", () => {
  it("names the proposer and the session and asks the speaker to confirm willingness or decline", () => {
    const rendered = compileSeededBody(seededBody(), {
      firstName: "Co",
      eventName: "PQC 2026",
      invitedByDisplay: "Ada Lovelace (Example Org)",
      proposalTitle: "Post-Quantum Migration Strategies",
      proposalAbstract: "A practical guide to migrating enterprise PKI.",
      speakerLineupText: "- Ada Lovelace (Example Org)",
      manageUrl: "https://pkic.org/portal/#/events/pqc-2026/proposals/proposal-1/participation?speaker=user-1",
    });
    expect(rendered).toContain("Dear Co,");
    expect(rendered).toContain("Ada Lovelace (Example Org) has proposed a session for **PQC 2026**");
    expect(rendered).toContain("**Post-Quantum Migration Strategies**");
    expect(rendered).toContain("A practical guide to migrating enterprise PKI.");
    expect(rendered).toContain("let us know whether you will speak");
    expect(rendered).toContain("Confirming as a speaker doesn't mean the proposal is accepted");
    expect(rendered).toContain("An organizer then reviews your response");
    expect(rendered).toContain("Review and respond");
    expect(rendered).toContain(
      "(https://pkic.org/portal/#/events/pqc-2026/proposals/proposal-1/participation?speaker=user-1)",
    );
  });

  it.each([
    [undefined, "The proposer"],
    ["Ada", "Ada"],
  ])("reads naturally without an inviter or abstract, using proposer %s", (proposerFirstName, proposerLabel) => {
    const rendered = compileSeededBody(seededBody(), {
      eventName: "PQC 2026",
      proposerFirstName,
      proposalTitle: "Post-Quantum Migration Strategies",
      manageUrl: "https://pkic.org/x",
    });
    expect(rendered).toContain("Hello,");
    expect(rendered).toContain(`${proposerLabel} has proposed a session for **PQC 2026**`);
    expect(rendered).not.toContain("Speakers on this proposal");
  });
});
