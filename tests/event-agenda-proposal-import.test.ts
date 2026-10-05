import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { eventProposalsResponseSchema } from "../assets/shared/schemas/event-proposals";
import { agendaImportResponseSchema } from "../assets/shared/schemas/event-agenda";
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
    await env.DB.prepare(
      "INSERT INTO event_agenda_contents(id,event_id,title,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, "Imported content", `proposal:${ids[0]}`, now, now)
      .run();
    const result = await list();
    expect(result.proposals.find((proposal) => proposal.id === ids[0])?.agendaImported).toBe(true);
    expect(result.proposals.find((proposal) => proposal.id === ids[1])?.agendaImported).toBe(false);
    expect(JSON.stringify(result)).not.toContain(`proposal:${ids[0]}`);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first("count")).toBe(0);
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
