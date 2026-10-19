import { declineSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-decline";
import { buildAddProposalSpeaker } from "../functions/_lib/services/proposal-speakers";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  eventProposalDetailResponseSchema,
  eventProposalsResponseSchema,
} from "../assets/shared/schemas/event-proposals";
import { preparePublicAgendaSnapshot } from "../functions/_lib/services/event-agenda/public-snapshot";
import { prepareCreateAgendaContent } from "../functions/_lib/services/event-agenda/content-library";
import { agendaImportResponseSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
let eventId = "",
  actor = "",
  token = "";
async function seedProposals(count: number, status = "accepted", owner = eventId) {
  const ids = Array.from({ length: count }, () => crypto.randomUUID()),
    now = new Date().toISOString();
  for (let offset = 0; offset < ids.length; offset += 100)
    await env.DB.batch(
      ids
        .slice(offset, offset + 100)
        .map((id) =>
          env.DB.prepare(
            "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES(?,?,?,?, 'talk',?,?,?, ?,?)",
          ).bind(
            id,
            owner,
            actor,
            status,
            `Synthetic proposal ${id}`,
            "Source abstract",
            crypto.randomUUID(),
            now,
            now,
          ),
        ),
    );
  return ids;
}
function importRequest(body: unknown) {
  return callApi(env, "/api/v1/events/pqc-2026/agenda/imports", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  await resetDb();
  ({ eventId } = await seedEventAndAdmin(env.DB));
  actor = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, actor, "proposal-batch-import");
});
describe("accepted proposal batch import", () => {
  it("imports an explicit batch from a large event without truncating rosters or reading unrelated decisions", async () => {
    const accepted = await seedProposals(101);
    await seedProposals(1001, "rejected");
    const proposalIds = [accepted[0], accepted[100]];
    for (const id of proposalIds)
      await env.DB.prepare(
        "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'moderator','confirmed',?)",
      )
        .bind(crypto.randomUUID(), id, actor, new Date().toISOString())
        .run();
    expect((await importRequest({ expectedRevision: 0, source: "accepted_proposals", dryRun: true })).status).toBe(422);
    const preview = await importRequest({
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds,
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(agendaImportResponseSchema.parse(await preview.json())).toMatchObject({
      imported: 2,
      agenda: { revision: 0, occurrences: [] },
    });
    const applied = await importRequest({
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds,
      dryRun: false,
    });
    expect(applied.status).toBe(200);
    const result = agendaImportResponseSchema.parse(await applied.json());
    expect(result).toMatchObject({ imported: 2, agenda: { revision: 1, publishedRevision: null } });
    expect(
      result.agenda.occurrences.every(
        (row) =>
          row.startAt === null &&
          row.speakers.length === 1 &&
          row.speakers[0].role === "moderator" &&
          row.speakers[0].userId === actor,
      ),
    ).toBe(true);
    const retry = await importRequest({
      expectedRevision: 1,
      source: "accepted_proposals",
      proposalIds,
      dryRun: false,
    });
    expect(retry.status).toBe(200);
    expect(agendaImportResponseSchema.parse(await retry.json())).toMatchObject({
      imported: 0,
      skipped: 2,
      agenda: { revision: 1 },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM session_proposals WHERE id IN(SELECT value FROM json_each(?)) AND status='accepted'",
      )
        .bind(JSON.stringify(proposalIds))
        .first("count"),
    ).toBe(2);
    await env.DB.prepare("UPDATE session_proposals SET status='withdrawn',withdrawn_at=? WHERE id=?")
      .bind(new Date().toISOString(), proposalIds[0])
      .run();
    const review = await importRequest({
      expectedRevision: 1,
      source: "accepted_proposals",
      proposalIds: [proposalIds[1]],
      dryRun: false,
    });
    expect(review.status).toBe(200);
    expect(agendaImportResponseSchema.parse(await review.json())).toMatchObject({
      imported: 0,
      skipped: 1,
      reviewRequired: 1,
    });
    expect(
      JSON.parse(
        (await env.DB.prepare("SELECT source_review_json FROM event_agenda_contents WHERE event_id=? AND source_key=?")
          .bind(eventId, `proposal:${proposalIds[0]}`)
          .first<string>("source_review_json"))!,
      ),
    ).toMatchObject({ reason: "source_withdrawn" });
  });
  it("refuses a batch containing nonaccepted or foreign proposals without allocating content", async () => {
    const accepted = await seedProposals(1),
      rejected = await seedProposals(1, "rejected");
    const now = new Date().toISOString(),
      other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'other-import-event','Other','UTC','{}',?,?)",
    )
      .bind(other, now, now)
      .run();
    const foreign = await seedProposals(1, "accepted", other);
    for (const id of [rejected[0], foreign[0], crypto.randomUUID()]) {
      const response = await importRequest({
        expectedRevision: 0,
        source: "accepted_proposals",
        proposalIds: [accepted[0], id],
        dryRun: false,
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_IMPORT_PROPOSAL_INELIGIBLE" } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first("count")).toBe(0);
  });
  it("projects imported source indicators within the proposal event without exposing source keys", async () => {
    const ids = await seedProposals(2),
      other = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'indicator-other','Other','UTC','{}',?,?)",
    )
      .bind(other, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_contents(id,event_id,title,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), other, "Other event source", `proposal:${ids[0]}`, now, now)
      .run();
    async function list() {
      const response = await callApi(env, "/api/v1/events/pqc-2026/proposals?status=accepted&limit=25&offset=0", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      return eventProposalsResponseSchema.parse(await response.json());
    }
    expect((await list()).proposals.every((proposal) => proposal.agendaImported === false)).toBe(true);
    // Written through the canonical content path, which records the proposal it came from.
    await prepareCreateAgendaContent(
      env.DB,
      eventId,
      crypto.randomUUID(),
      { title: "Imported content", speakerUserIds: [], speakerRoles: {} },
      `proposal:${ids[0]}`,
    ).run();
    const result = await list();
    expect(result.proposals.find((proposal) => proposal.id === ids[0])?.agendaImported).toBe(true);
    expect(result.proposals.find((proposal) => proposal.id === ids[1])?.agendaImported).toBe(false);
    expect(JSON.stringify(result)).not.toContain(`proposal:${ids[0]}`);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first("count")).toBe(0);
  });
  it("links a legacy session to its one accepted proposal by title when written, and counts speakers not yet accepted", async () => {
    const ids = await seedProposals(4),
      roomId = crypto.randomUUID(),
      contentId = crypto.randomUUID(),
      occurrenceId = crypto.randomUUID(),
      now = new Date().toISOString();
    const titleOf = async (id: string) =>
      (await env.DB.prepare("SELECT title FROM session_proposals WHERE id=?").bind(id).first<string>("title"))!;
    const title = await titleOf(ids[0]),
      ambiguous = await titleOf(ids[2]);
    // Two accepted proposals share one title, so a legacy session with it cannot say which it is.
    await env.DB.prepare("UPDATE session_proposals SET title=? WHERE id=?").bind(ambiguous, ids[3]).run();
    const content = (title: string) => ({ title, speakerUserIds: [], speakerRoles: {} });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Room B',40)").bind(
        roomId,
        eventId,
      ),
      prepareCreateAgendaContent(env.DB, eventId, contentId, content(` ${title.toUpperCase()} `), "legacy:synthetic"),
      prepareCreateAgendaContent(env.DB, eventId, crypto.randomUUID(), content(ambiguous), "legacy:ambiguous"),
      // A session typed in by hand is never linked, whatever its title.
      prepareCreateAgendaContent(env.DB, eventId, crypto.randomUUID(), content(await titleOf(ids[1]))),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,content_id,source_key) VALUES(?,?,?,?,?,?,?,'legacy:synthetic')",
      ).bind(occurrenceId, eventId, title, "2026-12-03T13:00:00.000Z", "2026-12-03T13:45:00.000Z", roomId, contentId),
      env.DB.prepare(
        "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'co_speaker','invited',?)",
      ).bind(crypto.randomUUID(), ids[0], actor, now),
    ]);
    async function list(agenda: "imported" | "unimported") {
      const response = await callApi(
        env,
        `/api/v1/events/pqc-2026/proposals?status=accepted&agenda=${agenda}&limit=25&offset=0`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      return eventProposalsResponseSchema.parse(await response.json()).proposals;
    }
    expect((await list("unimported")).map((proposal) => proposal.id).sort()).toEqual([ids[1], ids[2], ids[3]].sort());
    expect(await list("imported")).toEqual([
      expect.objectContaining({
        id: ids[0],
        agendaImported: true,
        agendaPlacement: { startAt: "2026-12-03T13:00:00.000Z", roomName: "Room B" },
      }),
    ]);
    const agenda = await callApi(env, "/api/v1/events/pqc-2026/agenda", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(agenda.status).toBe(200);
    const snapshot = agendaSnapshotSchema.parse(await agenda.json());
    expect(snapshot.occurrences.find((item) => item.id === occurrenceId)?.pendingSpeakerCount).toBe(1);
    expect(
      preparePublicAgendaSnapshot(snapshot, snapshot.revision + 1).occurrences.some(
        (item) => "pendingSpeakerCount" in item,
      ),
    ).toBe(false);
  });
  it("places one accepted proposal atomically while retaining canonical content and credits", async () => {
    const [proposalId] = await seedProposals(1),
      roomId = crypto.randomUUID(),
      overflow = crypto.randomUUID();
    await env.DB.batch(
      [roomId, overflow].map((id) =>
        env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)").bind(
          id,
          eventId,
          id,
        ),
      ),
    );
    await env.DB.prepare(
      "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'moderator','confirmed',?)",
    )
      .bind(crypto.randomUUID(), proposalId, actor, new Date().toISOString())
      .run();
    const body = {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      proposalPlacement: {
        proposalId,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        additionalRoomIds: [overflow],
      },
    };
    const preview = await importRequest({ ...body, dryRun: true });
    expect(preview.status).toBe(200);
    const reviewed = agendaImportResponseSchema.parse(await preview.json());
    expect(reviewed).toMatchObject({
      imported: 1,
      placementPreview: { title: `Synthetic proposal ${proposalId}`, description: "Source abstract", speakerCount: 1 },
      agenda: { revision: 0, occurrences: [] },
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    const applied = await importRequest({
      ...body,
      dryRun: false,
      expectedPlacementFingerprint: reviewed.placementFingerprint,
    });
    expect(applied.status).toBe(200);
    const result = agendaImportResponseSchema.parse(await applied.json());
    expect(result.agenda).toMatchObject({ revision: 1, publishedRevision: null });
    const { proposalId: sourceId, ...expectedPlacement } = body.proposalPlacement;
    expect(sourceId).toBe(proposalId);
    expect(result.agenda.occurrences[0]).toMatchObject({
      ...expectedPlacement,
      title: `Synthetic proposal ${proposalId}`,
      description: "Source abstract",
      speakers: [{ userId: actor, role: "moderator" }],
    });
    expect(
      await env.DB.prepare("SELECT source_key FROM event_agenda_contents WHERE event_id=?")
        .bind(eventId)
        .first("source_key"),
    ).toBe(`proposal:${proposalId}`);
    const retry = await importRequest({
      ...body,
      expectedRevision: 1,
      dryRun: false,
      expectedPlacementFingerprint: reviewed.placementFingerprint,
    });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ error: { code: "AGENDA_PROPOSAL_ALREADY_IMPORTED" } });
    expect(
      await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first("revision"),
    ).toBe(1);
  });
  it("never carries a proposal's notes for the program committee into the agenda or its publication", async () => {
    const [proposalId] = await seedProposals(1);
    const notes = "Private context for the committee only: the vendor has not cleared this case study.";
    await env.DB.prepare("UPDATE session_proposals SET committee_notes=? WHERE id=?").bind(notes, proposalId).run();
    const roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)")
      .bind(roomId, eventId, "Main room")
      .run();
    const body = {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      proposalPlacement: {
        proposalId,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        additionalRoomIds: [],
      },
    };
    const preview = agendaImportResponseSchema.parse(await (await importRequest({ ...body, dryRun: true })).json());
    expect(JSON.stringify(preview)).not.toContain(notes);
    const applied = await importRequest({
      ...body,
      dryRun: false,
      expectedPlacementFingerprint: preview.placementFingerprint,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const result = agendaImportResponseSchema.parse(await applied.json());
    expect(result.agenda.occurrences[0]?.description).toBe("Source abstract");
    expect(JSON.stringify(result.agenda)).not.toContain(notes);
    expect(JSON.stringify(preparePublicAgendaSnapshot(result.agenda, 1, new Date().toISOString(), true))).not.toContain(
      notes,
    );
    const stored = await env.DB.prepare("SELECT * FROM event_agenda_contents WHERE event_id=?").bind(eventId).all();
    expect(JSON.stringify(stored.results)).not.toContain(notes);
    // Reviewers and organizers still read them on the proposal.
    const detail = await callApi(env, `/api/v1/proposals/${proposalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(eventProposalDetailResponseSchema.parse(await detail.json()).proposal.committee_notes).toBe(notes);
  });
  it("takes a declining speaker off the placed session in the decline's batch and tells the organizers", async () => {
    const [proposalId] = await seedProposals(1);
    const roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)")
      .bind(roomId, eventId, "Main room")
      .run();
    const coSpeaker = await findOrCreateUser(env.DB, {
      email: "declining@example.test",
      firstName: "Dee",
      lastName: "Clines",
    });
    const tokens: Record<string, string> = {};
    for (const [userId, role] of [
      [actor, "speaker"],
      [coSpeaker.id, "co_speaker"],
    ] as const) {
      const prepared = await buildAddProposalSpeaker(env.DB, {
        proposalId,
        userId,
        role,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
      });
      await env.DB.batch(prepared.statements);
      tokens[userId] = prepared.manageToken;
    }
    await env.DB.prepare("UPDATE proposal_speakers SET status='confirmed', confirmed_at=? WHERE proposal_id=?")
      .bind(new Date().toISOString(), proposalId)
      .run();
    const body = {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      proposalPlacement: {
        proposalId,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        additionalRoomIds: [],
      },
    };
    const preview = agendaImportResponseSchema.parse(await (await importRequest({ ...body, dryRun: true })).json());
    const applied = await importRequest({
      ...body,
      dryRun: false,
      expectedPlacementFingerprint: preview.placementFingerprint,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const occurrenceSpeakers = () =>
      queryAll<{ user_id: string }>(
        env.DB,
        "SELECT speaker.user_id FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=? ORDER BY speaker.user_id",
        [eventId],
      );
    expect((await occurrenceSpeakers()).map((row) => row.user_id).sort()).toEqual([actor, coSpeaker.id].sort());
    const revisionBefore = await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
      .bind(eventId)
      .first<number>("revision");

    await declineSpeakerParticipation(env.DB, tokens[coSpeaker.id]!, env.INTERNAL_SIGNING_SECRET!, {
      reason: "Unavailable",
      appBaseUrl: "https://app.test",
    });
    // Off the session and the proposal's content, in the same batch; the draft moves on a revision.
    expect((await occurrenceSpeakers()).map((row) => row.user_id)).toEqual([actor]);
    const content = await env.DB.prepare("SELECT speaker_user_ids_json FROM event_agenda_contents WHERE source_key=?")
      .bind(`proposal:${proposalId}`)
      .first<string>("speaker_user_ids_json");
    expect(JSON.parse(content!)).toEqual([actor]);
    expect(
      await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first("revision"),
    ).toBe(revisionBefore! + 1);
    const notices = await queryAll<{ recipient_user_id: string; payload_json: string }>(
      env.DB,
      "SELECT recipient_user_id, payload_json FROM email_outbox WHERE template_key='agenda_speaker_declined'",
    );
    expect(notices.map((notice) => notice.recipient_user_id)).toContain(actor);
    const data = await deliveredEmailPayload<Record<string, unknown>>(env.DB, env, notices[0]!.payload_json);
    expect(JSON.stringify(data.speakerName)).toContain("Dee Clines");
    // One speaker remains, so nothing is flagged as left without speakers.
    expect(JSON.stringify(data.sessionsWithoutSpeakers)).toContain('""');
  });

  it("flags a placed session that a decline leaves without speakers instead of removing it", async () => {
    const [proposalId] = await seedProposals(1);
    const roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)")
      .bind(roomId, eventId, "Main room")
      .run();
    const speaker = await findOrCreateUser(env.DB, { email: "only@example.test", firstName: "Only", lastName: "One" });
    const prepared = await buildAddProposalSpeaker(env.DB, {
      proposalId,
      userId: speaker.id,
      role: "speaker",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await env.DB.batch(prepared.statements);
    await env.DB.prepare("UPDATE proposal_speakers SET status='confirmed', confirmed_at=? WHERE proposal_id=?")
      .bind(new Date().toISOString(), proposalId)
      .run();
    // The proposer is on the roster but not presenting, so the presenter may decline.
    await env.DB.prepare(
      "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'proposer','confirmed',?)",
    )
      .bind(crypto.randomUUID(), proposalId, actor, new Date().toISOString())
      .run();
    const now = new Date().toISOString();
    const occurrenceId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES(?,3,?)").bind(eventId, now),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,source_key) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        occurrenceId,
        eventId,
        "Solo session",
        "2026-12-01T09:00:00.000Z",
        "2026-12-01T10:00:00.000Z",
        roomId,
        `proposal:${proposalId}`,
      ),
      env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)").bind(
        occurrenceId,
        speaker.id,
      ),
    ]);
    await declineSpeakerParticipation(env.DB, prepared.manageToken, env.INTERNAL_SIGNING_SECRET!, {
      appBaseUrl: "https://app.test",
    });
    // The session stays; the organizers are told it now has no speakers.
    expect(
      await env.DB.prepare("SELECT id FROM event_agenda_occurrences WHERE id=?").bind(occurrenceId).first("id"),
    ).toBe(occurrenceId);
    expect(
      await queryAll(env.DB, "SELECT user_id FROM event_agenda_occurrence_speakers WHERE occurrence_id=?", [
        occurrenceId,
      ]),
    ).toEqual([]);
    const notice = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='agenda_speaker_declined' LIMIT 1",
    ).first<string>("payload_json");
    const data = await deliveredEmailPayload<Record<string, unknown>>(env.DB, env, notice!);
    expect(JSON.stringify(data.sessionsWithoutSpeakers)).toContain("Solo session");
  });
  it("refuses invalid placement contracts and scheduling conflicts without creating content", async () => {
    const [proposalId] = await seedProposals(1),
      roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?, 'Room',40)")
      .bind(roomId, eventId)
      .run();
    const placement = { proposalId, startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z", roomId };
    const body = {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      proposalPlacement: placement,
      dryRun: false,
    };
    for (const invalid of [
      { ...body, source: "legacy" },
      { ...body, proposalIds: undefined },
      { ...body, proposalPlacement: { ...placement, proposalId: crypto.randomUUID() } },
      { ...body, proposalPlacement: { ...placement, endAt: placement.startAt } },
      { ...body, proposalPlacement: { ...placement, additionalRoomIds: [roomId] } },
    ])
      expect((await importRequest(invalid)).status).toBe(400);
    for (const conflict of [
      { ...placement, roomId: crypto.randomUUID() },
      { ...placement, startAt: "2026-12-01T07:00:00.000Z" },
    ]) {
      const response = await importRequest({ ...body, dryRun: true, proposalPlacement: conflict });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_SCHEDULE_CONFLICT" } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    const unauthorized = await callApi(env, "/api/v1/events/pqc-2026/agenda/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, dryRun: true }),
    });
    expect(unauthorized.status).toBe(401);
  });
  it("uses confirmed speaker conflicts and half-open session boundaries for placed imports", async () => {
    const [first, second] = await seedProposals(2),
      rooms = [crypto.randomUUID(), crypto.randomUUID()];
    await env.DB.batch(
      rooms.map((id) =>
        env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)").bind(
          id,
          eventId,
          id,
        ),
      ),
    );
    await env.DB.batch(
      [first, second].map((id) =>
        env.DB.prepare(
          "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'speaker','confirmed',?)",
        ).bind(crypto.randomUUID(), id, actor, new Date().toISOString()),
      ),
    );
    async function placed(
      proposalId: string,
      expectedRevision: number,
      startAt: string,
      endAt: string,
      roomId: string,
    ) {
      const body = {
        source: "accepted_proposals",
        proposalIds: [proposalId],
        expectedRevision,
        dryRun: false,
        proposalPlacement: { proposalId, startAt, endAt, roomId },
      };
      const review = await importRequest({ ...body, dryRun: true });
      if (review.status !== 200) return review;
      const result = agendaImportResponseSchema.parse(await review.json());
      return importRequest({ ...body, expectedPlacementFingerprint: result.placementFingerprint });
    }
    expect((await placed(first, 0, "2026-12-01T09:00:00.000Z", "2026-12-01T10:00:00.000Z", rooms[0])).status).toBe(200);
    const overlap = await placed(second, 1, "2026-12-01T09:30:00.000Z", "2026-12-01T10:30:00.000Z", rooms[1]);
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({ error: { code: "AGENDA_SCHEDULE_CONFLICT" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(1);
    const adjacent = await placed(second, 1, "2026-12-01T10:00:00.000Z", "2026-12-01T11:00:00.000Z", rooms[0]);
    expect(adjacent.status).toBe(200);
    expect(agendaImportResponseSchema.parse(await adjacent.json()).agenda.revision).toBe(2);
  });
  it("refuses source edits after placement review without allocating agenda data", async () => {
    const [proposalId] = await seedProposals(1),
      roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?, 'Room',40)")
      .bind(roomId, eventId)
      .run();
    const body = {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      proposalPlacement: { proposalId, startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z", roomId },
    };
    const preview = await importRequest({ ...body, dryRun: true });
    expect(preview.status).toBe(200);
    const reviewed = agendaImportResponseSchema.parse(await preview.json());
    expect(reviewed.placementFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect((await importRequest({ ...body, dryRun: false })).status).toBe(400);
    await env.DB.prepare("UPDATE session_proposals SET abstract='Changed after review' WHERE id=?")
      .bind(proposalId)
      .run();
    const stale = await importRequest({
      ...body,
      dryRun: false,
      expectedPlacementFingerprint: reviewed.placementFingerprint,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "AGENDA_PROPOSAL_REVIEW_CHANGED" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first("count")).toBe(0);
    const refreshed = await importRequest({ ...body, dryRun: true });
    const fresh = agendaImportResponseSchema.parse(await refreshed.json());
    expect(fresh.placementFingerprint).not.toBe(reviewed.placementFingerprint);
    expect(fresh.placementPreview).toEqual({
      title: `Synthetic proposal ${proposalId}`,
      description: "Changed after review",
      speakerCount: 0,
    });
    await env.DB.prepare(
      "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'moderator','confirmed',?)",
    )
      .bind(crypto.randomUUID(), proposalId, actor, new Date().toISOString())
      .run();
    const changedRoster = await importRequest({
      ...body,
      dryRun: false,
      expectedPlacementFingerprint: fresh.placementFingerprint,
    });
    expect(changedRoster.status).toBe(409);
    expect(await changedRoster.json()).toMatchObject({ error: { code: "AGENDA_PROPOSAL_REVIEW_CHANGED" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    const finalReview = await importRequest({ ...body, dryRun: true });
    const finalResult = agendaImportResponseSchema.parse(await finalReview.json());
    expect(finalResult.placementPreview?.speakerCount).toBe(1);
    expect(
      (await importRequest({ ...body, dryRun: false, expectedPlacementFingerprint: finalResult.placementFingerprint }))
        .status,
    ).toBe(200);
  });
  it("validates distinct batch IDs and keeps legacy imports separate", async () => {
    const [id] = await seedProposals(1);
    for (const body of [
      { source: "accepted_proposals", proposalIds: [id, id] },
      { source: "accepted_proposals", proposalIds: [] },
      { source: "accepted_proposals", proposalIds: Array.from({ length: 101 }, () => crypto.randomUUID()) },
      { source: "legacy", proposalIds: [id] },
    ])
      expect((await importRequest({ expectedRevision: 0, dryRun: false, ...body })).status).toBe(400);
  });
  it("refuses oversized confirmed rosters instead of silently clipping source credits", async () => {
    const [proposalId] = await seedProposals(1),
      now = new Date().toISOString(),
      people = Array.from({ length: 31 }, () => crypto.randomUUID());
    await env.DB.batch(
      people.map((id) =>
        env.DB.prepare(
          "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
        ).bind(id, `${id}@example.test`, `${id}@example.test`, now, now),
      ),
    );
    await env.DB.batch(
      people.map((id) =>
        env.DB.prepare(
          "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'speaker','confirmed',?)",
        ).bind(crypto.randomUUID(), proposalId, id, now),
      ),
    );
    const response = await importRequest({
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [proposalId],
      dryRun: false,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_IMPORT_SPEAKER_REVIEW_REQUIRED" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM proposal_speakers WHERE proposal_id=?")
        .bind(proposalId)
        .first("count"),
    ).toBe(31);
  });
});
