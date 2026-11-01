import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { promotionReferral } from "../../functions/_lib/services/event-agenda/promotion-referral";
import { findOrCreateUser } from "../../functions/_lib/services/users";
import { createAgendaOccurrence } from "../../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { seedEventAndAdmin } from "./context";
import { createAdminSession } from "./auth";
import { callApi } from "./app";

/** A published session with its speaker (the seeded admin), a registered attendee, and their sessions. */
export const eventBase = "/api/v1/events/pqc-2026";
export async function promotionFixture(withSecondSpeaker = false) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const admin = (await env.DB.prepare("SELECT id,email FROM users WHERE email='admin@pkic.org'").first<{
    id: string;
    email: string;
  }>())!;
  const headers = {
    authorization: `Bearer ${await createAdminSession(env.DB, admin.id, "promotion-admin")}`,
    "content-type": "application/json",
  };
  const secondSpeaker = withSecondSpeaker
    ? await findOrCreateUser(env.DB, { email: "bulk-speaker@example.test", firstName: "Second", lastName: "Speaker" })
    : null;
  const draft = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Planning a quantum-safe migration",
      description: "A practical session abstract about inventory, deployment and operational controls.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T09:30:00.000Z",
      roomId: null,
      speakerUserIds: secondSpeaker ? [admin.id, secondSpeaker.id] : [admin.id],
    }),
    admin.id,
  );
  const reviewed = await callApi(env, `${eventBase}/agenda/occurrences/${draft.occurrences[0]!.id}/history`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      expectedRevision: draft.revision,
      history: {
        appearances: [
          ...(secondSpeaker
            ? [
                {
                  userId: secondSpeaker.id,
                  displayName: "Second Speaker",
                  affiliations: [],
                  biography: "",
                  photoUrl: null,
                  approvedAt: new Date().toISOString(),
                },
              ]
            : []),
          {
            userId: admin.id,
            displayName: "Example Speaker",
            affiliations: [],
            biography: "",
            photoUrl: null,
            approvedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  });
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const review = agendaSnapshotSchema.parse(await reviewed.json());
  const publish = await callApi(env, `${eventBase}/agenda/publications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: review.revision }),
  });
  expect(publish.status, await publish.clone().text()).toBe(200);
  const published = agendaSnapshotSchema.parse(await publish.json()),
    sessionId = published.occurrences[0]!.id;
  const userId = crypto.randomUUID(),
    registrationId = crypto.randomUUID(),
    at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,first_name,last_name,created_at,updated_at) VALUES(?,'promotion-attendee@example.test','promotion-attendee@example.test',1,'Example','Attendee',?,?)",
    ).bind(userId, at, at),
    env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','direct','synthetic-secret',?,?)",
    ).bind(registrationId, eventId, userId, at, at),
  ]);
  await promotionReferral(env.DB, eventId, admin.id);
  await promotionReferral(env.DB, eventId, userId);
  const attendeeHeaders = {
    authorization: `Bearer ${await createAdminSession(env.DB, userId, "promotion-attendee")}`,
    "content-type": "application/json",
  };
  return {
    eventId,
    admin,
    secondSpeaker,
    headers,
    userId,
    attendeeHeaders,
    sessionId,
    sessionBase: `${eventBase}/agenda/occurrences/${sessionId}/promotion`,
  };
}
