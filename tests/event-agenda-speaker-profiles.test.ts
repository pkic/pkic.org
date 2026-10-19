import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaImportSchema,
  agendaImportResponseSchema,
  agendaRevisionSchema,
} from "../assets/shared/schemas/event-agenda";
import { sessionHistoryCorrectionSchema } from "../assets/shared/schemas/event-session-history";
import { agendaAuthoringFixture, agendaAuthoringEffects } from "./helpers/agenda-authoring";
import { resetDb } from "./helpers/reset-db";
import { insertOrganization } from "./helpers/membership";

beforeEach(resetDb);
async function fixture() {
  const f = await agendaAuthoringFixture(),
    photoKey = `headshots/${f.adminId}/portrait.jpg`,
    now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET first_name='Casey',last_name='Person',headshot_r2_key=? WHERE id=?")
    .bind(photoKey, f.adminId)
    .run();
  // The person speaks as their organization identity by default, or as an individual where they chose to.
  const organizationId = await insertOrganization(env.DB, "Profile Candidate Labs");
  const organizationIdentityId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE identities SET ended_at=? WHERE user_id=? AND ended_at IS NULL").bind(now, f.adminId),
    env.DB.prepare(
      `INSERT INTO identities(id,user_id,organization_id,job_title,biography,source,show_on_organization_profile,is_default,invited_at,started_at,created_at,updated_at)
       VALUES(?,?,?,'Principal engineer','Organization identity biography','staff',1,1,?,?,?,?)`,
    ).bind(organizationIdentityId, f.adminId, organizationId, now, now, now, now),
    env.DB.prepare(
      `INSERT INTO identities(id,user_id,organization_id,biography,source,show_on_organization_profile,invited_at,started_at,created_at,updated_at)
       VALUES(?,?,NULL,'Individual identity biography','account',0,?,?,?,?)`,
    ).bind(crypto.randomUUID(), f.adminId, now, now, now, now),
  ]);
  await env.DB.prepare("UPDATE events SET capacity_in_person=NULL WHERE id=?").bind(f.eventId).run();
  const agenda = await f.create({
    expectedRevision: 0,
    title: "Manual linked person",
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T10:00:00.000Z",
    roomId: null,
    speakerUserIds: [f.adminId],
  });
  /** An accepted proposal on which the person chose to take part as an individual. */
  const proposal = async (eventId: string) => {
    const id = crypto.randomUUID(),
      at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES(?,?,?,'accepted','talk','Accepted profile source','A substantive abstract about cryptographic operations and reliable lifecycle management.',?,?,?)",
    )
      .bind(id, eventId, f.adminId, crypto.randomUUID(), at, at)
      .run();
    await env.DB.prepare(
      "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,acting_identity_selected_at,created_at) VALUES(?,?,?,'speaker','confirmed',?,?)",
    )
      .bind(crypto.randomUUID(), id, f.adminId, at, at)
      .run();
    return id;
  };
  return {
    ...f,
    agenda,
    proposal,
    organizationIdentityId,
    photoUrl: `/api/v1/users/${f.adminId}/headshots/portrait.jpg`,
  };
}
describe("available speaker person profiles are organizer candidates only", () => {
  it("reads each credited person as the identity they speak as: the proposal's choice, else their primary", async () => {
    const f = await fixture(),
      source = await f.proposal(f.eventId);
    const response = await f.raw(
      "/imports",
      agendaImportSchema.parse({
        source: "accepted_proposals",
        expectedRevision: f.agenda.revision,
        dryRun: false,
        proposalIds: [source],
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const imported = agendaImportResponseSchema.parse(await response.json()).agenda;
    const manual = imported.occurrences.find((item) => item.id === f.agenda.occurrences[0]!.id)!;
    const accepted = imported.occurrences.find((item) => item.id !== manual.id)!;
    expect(manual.speakers[0]!.profileCandidate).toEqual({
      identityId: f.organizationIdentityId,
      organizationName: "Profile Candidate Labs",
      jobTitle: "Principal engineer",
      biography: "Organization identity biography",
      links: [],
      photoUrl: f.photoUrl,
    });
    expect(accepted.speakers[0]!.profileCandidate).toMatchObject({
      organizationName: null,
      biography: "Individual identity biography",
      photoUrl: f.photoUrl,
    });
    expect(manual.speakers[0]).not.toHaveProperty("organizationName");
    expect(accepted.speakers[0]).not.toHaveProperty("jobTitle");
    const before = await agendaAuthoringEffects();
    const preview = await f.saved(await f.raw("/previews?revision=draft"));
    expect(JSON.stringify(preview)).not.toContain("profileCandidate");
    expect(JSON.stringify(preview)).not.toContain("Organization identity biography");
    expect(JSON.stringify(preview)).not.toContain(f.photoUrl);
    expect(await agendaAuthoringEffects()).toEqual(before);
  });

  it("requires deliberate appearance approval and keeps approved public data frozen when the account profile changes", async () => {
    const f = await fixture(),
      id = f.agenda.occurrences[0]!.id;
    const rejected = await f.raw("/publications", agendaRevisionSchema.parse({ expectedRevision: f.agenda.revision }));
    expect(rejected.status).toBe(422);
    const reviewed = await f.saved(
      await f.raw(
        `/occurrences/${id}/history`,
        sessionHistoryCorrectionSchema.parse({
          expectedRevision: f.agenda.revision,
          history: {
            appearances: [
              {
                userId: f.adminId,
                affiliations: [],
                displayName: "Casey Person",
                biography: "Explicit approved biography",
                photoUrl: null,
                approvedAt: new Date().toISOString(),
              },
            ],
          },
        }),
      ),
    );
    const approved = await f.saved(
      await f.raw("/publications", agendaRevisionSchema.parse({ expectedRevision: reviewed.revision })),
    );
    const stored = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(f.eventId, approved.publishedRevision)
      .first<{ snapshot_json: string }>();
    expect(stored!.snapshot_json).not.toContain("profileCandidate");
    expect(stored!.snapshot_json).not.toContain("Organization identity biography");
    expect(stored!.snapshot_json).not.toContain(f.photoUrl);
    await env.DB.batch([
      env.DB.prepare("UPDATE identities SET biography='Later person profile' WHERE id=?").bind(
        f.organizationIdentityId,
      ),
      env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(
        `headshots/${f.adminId}/replacement.jpg`,
        f.adminId,
      ),
    ]);
    const draft = await f.saved(await f.raw(""));
    expect(draft.occurrences[0]!.speakers[0]!.profileCandidate?.biography).toBe("Later person profile");
    const publicPreview = await f.saved(await f.raw("/previews?revision=approved"));
    expect(publicPreview.occurrences[0]!.history?.appearances[0]?.biography).toBe("Explicit approved biography");
    expect(JSON.stringify(publicPreview)).not.toContain("Later person profile");
    expect(JSON.stringify(publicPreview)).not.toContain("replacement.jpg");
    expect(JSON.stringify(publicPreview)).not.toContain("profileCandidate");
  });
});
