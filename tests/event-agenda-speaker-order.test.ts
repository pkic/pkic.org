import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { addRepresentative, insertOrganization, seedOrganizationAggregate, insertUser } from "./helpers/membership";
import { callApi } from "./helpers/app";
import {
  agendaPeopleListSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";

beforeEach(resetDb);
it("retains authored speaker order after creation, reordering, and reloading", async () => {
  const { admin } = await seedEventAndAdmin(env.DB);
  const other = await insertUser(env.DB);
  const token = await createAdminSession(env.DB, admin.id, "speaker-order");
  const ordered = [admin.id, other].sort().reverse();
  const request = (method: string, path: string, body?: unknown) =>
    callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let response = await request(
    "POST",
    "/occurrences",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Opening",
      roomId: null,
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T09:30:00.000Z",
      speakerUserIds: ordered,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  let agenda = agendaSnapshotSchema.parse(await response.json());
  expect(agenda.occurrences[0]!.speakers.map((speaker) => speaker.userId)).toEqual(ordered);
  const reordered = [...ordered].reverse();
  response = await request(
    "PATCH",
    `/occurrences/${agenda.occurrences[0]!.id}`,
    agendaOccurrencePatchSchema.parse({
      expectedRevision: agenda.revision,
      speakerUserIds: reordered,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  response = await request("GET", "");
  expect(response.status).toBe(200);
  agenda = agendaSnapshotSchema.parse(await response.json());
  expect(agenda.occurrences[0]!.speakers.map((speaker) => speaker.userId)).toEqual(reordered);
});

it("finds current credited speakers without proposals or event roles and never treats history as membership", async () => {
  const { admin } = await seedEventAndAdmin(env.DB);
  const speakerId = await insertUser(env.DB);
  await insertUser(env.DB); // An unrelated active user must not enter the event's picker.
  const token = await createAdminSession(env.DB, admin.id, "retained-speaker");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const created = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences", {
    method: "POST",
    headers,
    body: JSON.stringify(
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Imported speaker",
        roomId: null,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T09:30:00.000Z",
        speakerUserIds: [speakerId],
      }),
    ),
  });
  expect(created.status).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await created.json());
  async function choices() {
    const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/people?q=Test&limit=10&offset=0", { headers });
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaPeopleListSchema.parse(await response.json());
  }
  expect((await choices()).users.map((user) => user.id)).toEqual([speakerId]);
  const occurrenceId = agenda.occurrences[0]!.id;
  await env.DB.prepare(
    "INSERT INTO event_agenda_session_history (occurrence_id,metadata_json,updated_at,updated_by) VALUES (?,?,?,?)",
  )
    .bind(
      occurrenceId,
      JSON.stringify(
        sessionHistoryMetadataSchema.parse({
          appearances: [
            {
              userId: speakerId,
              displayName: "Test speaker",
              affiliations: [],
              biography: "",
              links: [],
              photoUrl: null,
              approvedAt: new Date().toISOString(),
            },
          ],
        }),
      ),
      new Date().toISOString(),
      admin.id,
    )
    .run();
  await env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=?").bind(occurrenceId).run();
  expect((await choices()).users).toEqual([]);
});

it("saves the selected canonical identity and reads later identity changes without history", async () => {
  const { admin } = await seedEventAndAdmin(env.DB);
  const speakerId = await insertUser(env.DB);
  const organizationId = await insertOrganization(env.DB, "Canonical organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  const identityId = await addRepresentative(env.DB, memberId, speakerId, { jobTitle: "Researcher" });
  await env.DB.prepare("UPDATE identities SET started_at=? WHERE id=?")
    .bind(new Date().toISOString(), identityId)
    .run();
  const otherOrganization = await insertOrganization(env.DB, "Other default organization");
  const otherMember = await seedOrganizationAggregate(env.DB, otherOrganization);
  const defaultIdentity = await addRepresentative(env.DB, otherMember, speakerId, { jobTitle: "Other role" });
  await env.DB.prepare("UPDATE identities SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE user_id=?")
    .bind(defaultIdentity, speakerId)
    .run();
  const token = await createAdminSession(env.DB, admin.id, "canonical-speaker");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const choices = await callApi(
    env,
    "/api/v1/events/pqc-2026/agenda/speaker-identities?q=Canonical&limit=10&offset=0",
    {
      headers,
    },
  );
  expect(choices.status, await choices.clone().text()).toBe(200);
  expect(
    ((await choices.json()) as { identities: { identityId: string }[] }).identities.map((item) => item.identityId),
  ).toContain(identityId);
  const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences", {
    method: "POST",
    headers,
    body: JSON.stringify(
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Canonical speakers",
        roomId: null,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T09:30:00.000Z",
        speakerUserIds: [speakerId],
        speakerIdentityIds: { [speakerId]: [identityId, defaultIdentity] },
      }),
    ),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await response.json());
  expect(agenda.occurrences[0]!.speakers[0]!.profileCandidate).toMatchObject({
    identityId,
    jobTitle: "Researcher",
    organizationName: "Canonical organization",
  });
  expect(agenda.occurrences[0]!.speakers).toHaveLength(1);
  expect(agenda.occurrences[0]!.speakers[0]!.profileCandidates?.map((candidate) => candidate.identityId)).toEqual([
    identityId,
    defaultIdentity,
  ]);
  await env.DB.prepare("UPDATE identities SET job_title='Principal researcher' WHERE id=?").bind(identityId).run();
  const read = await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers });
  expect(agendaSnapshotSchema.parse(await read.json()).occurrences[0]!.speakers[0]!.profileCandidate?.jobTitle).toBe(
    "Principal researcher",
  );
  const patch = (identityMap: Record<string, string[]>) =>
    callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${agenda.occurrences[0]!.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: agenda.revision, speakerIdentityIds: identityMap }),
    });
  const wrongOwner = await patch({ [admin.id]: [identityId] });
  expect(wrongOwner.status).toBe(422);
  await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(new Date().toISOString(), identityId).run();
  const ended = await patch({ [speakerId]: [identityId] });
  expect(ended.status).toBe(422);
});
