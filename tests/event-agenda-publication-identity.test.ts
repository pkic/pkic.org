import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { prepareRepresentationEligibility } from "../functions/_lib/services/event-agenda/representation-eligibility";

beforeEach(resetDb);
async function fixture(historical = false) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<string>("id"))!;
  const organizationId = await insertOrganization(env.DB, "Original employer");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Original role" });
  await env.DB.prepare(
    "UPDATE identities SET invited_at='2022-01-01T00:00:00.000Z',started_at='2022-01-01T00:00:00.000Z' WHERE id=?",
  )
    .bind(identityId)
    .run();
  if (historical)
    await env.DB.prepare(
      "UPDATE events SET starts_at='2023-12-01T08:00:00.000Z',ends_at='2023-12-03T18:00:00.000Z' WHERE id=?",
    )
      .bind(eventId)
      .run();
  const startAt = historical ? "2023-12-01T10:00:00.000Z" : "2026-12-01T10:00:00.000Z";
  const agenda = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Reviewed speaker",
      visibility: "public",
      roomId: null,
      startAt,
      endAt: historical ? "2023-12-01T11:00:00.000Z" : "2026-12-01T11:00:00.000Z",
      speakerUserIds: [userId],
    }),
  );
  await seedApprovedSessionAppearances(env.DB, {
    occurrenceId: agenda.occurrences[0].id,
    reviewerId: userId,
    appearances: [
      {
        userId,
        actingIdentityId: identityId,
        displayName: "Original speaker",
        organizationName: "Original employer",
        jobTitle: "Original role",
        biography: "Approved biography",
        photoUrl: null,
        approvedAt: "2026-10-03T10:00:00.000Z",
      },
    ],
  });
  const token = await createAdminSession(env.DB, userId, "publication-identity");
  const publish = () =>
    callApi(env, "/api/v1/events/pqc-2026/agenda/publications", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: agenda.revision }),
    });
  return { userId, identityId, startAt, publish, revision: agenda.revision, eventId };
}
async function effects(eventId: string) {
  return {
    revision: await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
      .bind(eventId)
      .first("revision"),
    publications: await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications").first("count"),
    audits: await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count"),
    outbox: await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first("count"),
  };
}

describe("publication identity lifecycle", () => {
  it.each(["ended_at", "blocked_at"] as const)(
    "refuses a future appearance invalidated through %s after approval",
    async (column) => {
      const f = await fixture();
      const change = column === "blocked_at" ? "ended_at=?,blocked_at=?" : "ended_at=?";
      await env.DB.prepare(`UPDATE identities SET ${change} WHERE id=?`)
        .bind(
          ...(column === "blocked_at"
            ? ["2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]
            : ["2026-11-01T00:00:00.000Z"]),
          f.identityId,
        )
        .run();
      const before = await effects(f.eventId);
      const response = await f.publish();
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_IDENTITY_UNAVAILABLE" } });
      expect(await effects(f.eventId)).toEqual(before);
    },
  );
  it("publishes an ended historical affiliation without refreshing its frozen credit", async () => {
    const f = await fixture(true);
    await env.DB.prepare("UPDATE identities SET ended_at='2024-01-01T00:00:00.000Z',job_title='Later role' WHERE id=?")
      .bind(f.identityId)
      .run();
    const response = await f.publish();
    expect(response.status, await response.clone().text()).toBe(200);
    agendaSnapshotSchema.parse(await response.json());
    const row = await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(f.eventId)
      .first<string>("snapshot_json");
    expect(agendaSnapshotSchema.parse(JSON.parse(row!)).occurrences[0].history?.appearances[0]).toMatchObject({
      displayName: "Original speaker",
      organizationName: "Original employer",
      jobTitle: "Original role",
    });
  });
  it("rechecks prepared identity evidence inside the real D1 transaction", async () => {
    const f = await fixture();
    const guards = await prepareRepresentationEligibility(env.DB, [
      { userId: f.userId, actingIdentityId: f.identityId, at: f.startAt },
    ]);
    const before = await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(f.userId).first("first_name");
    await env.DB.prepare(
      "UPDATE identities SET ended_at='2026-11-01T00:00:00.000Z',blocked_at='2026-11-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(f.identityId)
      .run();
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(f.userId),
        ...guards,
      ]),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(f.userId).first("first_name")).toBe(
      before,
    );
  });
});
