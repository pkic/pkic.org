/**
 * The notice a proposer receives when a speaker declines: who declined, on which
 * proposal, the reason they gave, and the link to manage the proposal. Rendered by
 * the same engine the outbox uses, from the seeded template itself.
 */
import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";

function seeded() {
  const template = DEFAULT_TEMPLATES.find((candidate) => candidate.key === "proposal_speaker_declined");
  expect(template).toBeDefined();
  return template!;
}

const values = {
  firstName: "Ada",
  eventName: "PQC 2026",
  speakerName: "Grace Hopper",
  proposalTitle: "Post-Quantum Migration Strategies",
  manageUrl: "https://pkic.org/events/2026/pqc-2026/propose/manage/?token=t",
};

describe("speaker declined template", () => {
  it("names the speaker, the proposal and the reason, and links to the proposal", () => {
    const rendered = compileSimpleTemplate(
      seeded().content,
      { ...values, declineReason: "I am traveling that week." },
      "markdown",
    );
    expect(rendered).toContain("Hello Ada,");
    expect(rendered).toContain(
      "Grace Hopper declined to speak on your proposal **Post-Quantum Migration Strategies** for **PQC 2026**.",
    );
    expect(rendered).toContain("> I am traveling that week.");
    expect(rendered).toContain("[Manage my proposal](https://pkic.org/events/2026/pqc-2026/propose/manage/?token=t)");
    expect(compileSimpleTemplate(seeded().subjectTemplate ?? "", values, "markdown")).toBe(
      "A speaker declined your proposal — PQC 2026",
    );
  });

  it("leaves out the reason when none was given", () => {
    const rendered = compileSimpleTemplate(seeded().content, { ...values, firstName: "" }, "markdown");
    expect(rendered).toContain("Hello,");
    expect(rendered).not.toContain("They gave this reason");
  });
});
