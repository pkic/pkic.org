import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";

describe("proposal participants", () => {
  it("supports panel participants and stores user links", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const response = await submitProposal(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType: "direct",
            proposer: {
              firstName: "Panel",
              lastName: "Lead",
              email: "lead@example.test",
              organizationName: "Public University",
              jobTitle: "Researcher",
              bio: "Leads cross-industry cryptography migration planning and public policy coordination programs.",
              links: ["https://example.test/lead", "https://linkedin.com/in/lead"],
            },
            proposal: {
              type: "panel",
              title: "Panel: Real-world PQC Migration Governance",
              abstract:
                "Panel discussion on organizational governance, procurement, stakeholder management, and transition planning for post-quantum cryptography programs in regulated environments.",
            },
            speakers: [
              {
                firstName: "Panelist",
                lastName: "One",
                email: "panelist1@example.test",
                role: "panelist",
                organizationName: "National Agency",
                jobTitle: "Architect",
                bio: "Builds enterprise security reference architectures and guides cryptographic agility programs.",
                links: ["https://github.com/panelist1"],
              },
              {
                firstName: "Moderator",
                lastName: "One",
                email: "moderator@example.test",
                role: "moderator",
                organizationName: "Community Foundation",
                jobTitle: "Program Director",
                bio: "Moderates industry forums focused on interoperability and deployment readiness.",
                links: ["https://x.com/moderator"],
              },
            ],
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { proposalId: string };

    const roles = db.raw<{ role: string }>(
      "SELECT role FROM proposal_speakers WHERE proposal_id = ? ORDER BY role",
      [payload.proposalId],
    );
    expect(roles.map((entry) => entry.role)).toContain("panelist");
    expect(roles.map((entry) => entry.role)).toContain("moderator");

    const participantRoles = db.raw<{ role: string }>(
      "SELECT role FROM event_participants WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?) ORDER BY role",
      [payload.proposalId],
    );
    expect(participantRoles.map((entry) => entry.role)).toContain("panelist");
    expect(participantRoles.map((entry) => entry.role)).toContain("moderator");

    const linkRows = db.raw<{ links_json: string | null }>(
      "SELECT links_json FROM users WHERE id IN (SELECT user_id FROM proposal_speakers WHERE proposal_id = ?)",
      [payload.proposalId],
    );
    expect(linkRows.some((entry) => Boolean(entry.links_json))).toBe(true);
  });
});
