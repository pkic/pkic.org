import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import {
  createAgendaContent,
  updateAgendaContent,
  placeAgendaContent,
  copyAgendaContent,
  listAgendaContents,
} from "../functions/_lib/services/event-agenda/content-library";
import { importAgenda } from "../functions/_lib/services/event-agenda/import";
import { patchAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
const eventId = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  speaker = crypto.randomUUID();
const content = {
  title: "Reusable workshop",
  description: "Canonical abstract",
  kind: "session" as const,
  speakerUserIds: [speaker],
};
async function revision() {
  return (await getAgenda(env.DB, eventId, "library")).revision;
}
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  for (const id of [actor, speaker])
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run();
  await grantAdministrator(env.DB, actor);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'library','Library','Europe/Amsterdam','invite_or_open','{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
});
describe("Canonical session content and import review", () => {
  it("preserves confirmed moderator credit and flags a withdrawn proposal without changing the decision", async () => {
    const proposal = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES(?,?,?,'accepted','panel','Accepted panel','Panel abstract',?,?,?)",
    )
      .bind(proposal, eventId, actor, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'moderator','confirmed',?)",
    )
      .bind(crypto.randomUUID(), proposal, speaker, now)
      .run();
    const imported = await importAgenda(
      env.DB,
      eventId,
      "library",
      { source: "accepted_proposals", dryRun: false, expectedRevision: 0, occurrences: [] },
      actor,
    );
    const occurrence = imported.agenda.occurrences[0]!;
    expect(
      await env.DB.prepare("SELECT role FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?")
        .bind(occurrence.id, speaker)
        .first("role"),
    ).toBe("moderator");
    const item = (await listAgendaContents(env.DB, eventId, {})).contents[0]!;
    expect(item.speakerRoles[speaker]).toBe("moderator");
    const repeated = await placeAgendaContent(env.DB, eventId, "library", item.id, await revision(), false, actor);
    expect(
      await env.DB.prepare("SELECT role FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?")
        .bind(repeated.occurrenceId, speaker)
        .first("role"),
    ).toBe("moderator");
    await env.DB.prepare("UPDATE session_proposals SET status='withdrawn',withdrawn_at=? WHERE id=?")
      .bind(now, proposal)
      .run();
    const reviewed = await importAgenda(
      env.DB,
      eventId,
      "library",
      { source: "accepted_proposals", dryRun: false, expectedRevision: await revision(), occurrences: [] },
      actor,
    );
    expect(reviewed.reviewRequired).toBe(1);
    expect((await listAgendaContents(env.DB, eventId, {})).contents[0]!.review).toMatchObject({
      reason: "source_withdrawn",
      incoming: null,
    });
    expect(await env.DB.prepare("SELECT status FROM session_proposals WHERE id=?").bind(proposal).first("status")).toBe(
      "withdrawn",
    );
    expect(
      await env.DB.prepare("SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?")
        .bind(proposal, speaker)
        .first("status"),
    ).toBe("confirmed");
  });
  it("stores unscheduled content without manufacturing an occurrence", async () => {
    const item = await createAgendaContent(env.DB, eventId, 0, content, actor);
    expect(item.occurrenceCount).toBe(0);
    expect((await getAgenda(env.DB, eventId, "library")).occurrences).toHaveLength(0);
    expect((await listAgendaContents(env.DB, eventId, { q: "workshop" })).contents).toHaveLength(1);
  });
  it("links repeated occurrences and updates their draft content together", async () => {
    const item = await createAgendaContent(env.DB, eventId, 0, content, actor);
    const first = await placeAgendaContent(env.DB, eventId, "library", item.id, await revision(), false, actor);
    const second = await placeAgendaContent(env.DB, eventId, "library", item.id, await revision(), false, actor);
    expect(first.occurrenceId).not.toBe(second.occurrenceId);
    await updateAgendaContent(
      env.DB,
      eventId,
      item.id,
      await revision(),
      { ...content, title: "Revised workshop" },
      false,
      actor,
    );
    const agenda = await getAgenda(env.DB, eventId, "library");
    expect(agenda.occurrences.map((row) => row.title)).toEqual(["Revised workshop", "Revised workshop"]);
    expect(
      agenda.occurrences.every(
        (row) => row.contentId === item.id && row.startAt === null && row.visibility === "private",
      ),
    ).toBe(true);
  });
  it("creates an independent copy without dates, rooms, capacities, publication or operational credentials", async () => {
    const item = await createAgendaContent(env.DB, eventId, 0, content, actor);
    const placed = await placeAgendaContent(env.DB, eventId, "library", item.id, await revision(), false, actor);
    await patchAgendaOccurrence(
      env.DB,
      eventId,
      "library",
      placed.occurrenceId,
      {
        expectedRevision: await revision(),
        startAt: "2027-01-02T10:00:00.000Z",
        endAt: "2027-01-02T11:00:00.000Z",
        capacity: 20,
        visibility: "public",
      },
      actor,
    );
    const copied = await placeAgendaContent(env.DB, eventId, "library", item.id, await revision(), true, actor);
    expect(copied.contentId).not.toBe(item.id);
    const row = copied.agenda.occurrences.find((row) => row.id === copied.occurrenceId)!;
    expect(row).toMatchObject({
      startAt: null,
      endAt: null,
      roomId: null,
      capacity: null,
      remoteCapacity: null,
      visibility: "private",
    });
    expect(copied.agenda.publishedRevision).toBeNull();
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_session_participations WHERE occurrence_id=?")
        .bind(copied.occurrenceId)
        .first("count"),
    ).toBe(0);
  });
  it("copies substantive content to a new event without sharing content identity", async () => {
    const item = await createAgendaContent(env.DB, eventId, 0, content, actor),
      other = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'new-event','New','UTC','invite_or_open','{}',?,?)",
    )
      .bind(other, now, now)
      .run();
    const copy = await copyAgendaContent(env.DB, eventId, item.id, other, 0, actor);
    expect(copy.id).not.toBe(item.id);
    expect(copy).toMatchObject({ eventId: other, sourceKey: null, occurrenceCount: 0 });
  });
  it("flags reimported source changes without erasing a later local edit", async () => {
    const candidate = {
      ...content,
      sourceKey: "archive:workshop",
      startAt: null,
      endAt: null,
      roomId: null,
      admissionPolicy: "preference" as const,
      capacity: null,
      remoteCapacity: null,
      visibility: "public" as const,
    };
    const first = await importAgenda(
      env.DB,
      eventId,
      "library",
      { source: "legacy", dryRun: false, expectedRevision: 0, occurrences: [candidate] },
      actor,
    );
    const occurrence = first.agenda.occurrences[0]!;
    await patchAgendaOccurrence(
      env.DB,
      eventId,
      "library",
      occurrence.id,
      { expectedRevision: await revision(), title: "Organizer edited title" },
      actor,
    );
    const incoming = { ...candidate, title: "Source corrected title" };
    const rerun = await importAgenda(
      env.DB,
      eventId,
      "library",
      { source: "legacy", dryRun: false, expectedRevision: await revision(), occurrences: [incoming] },
      actor,
    );
    expect(rerun.imported).toBe(0);
    expect(rerun.reviewRequired).toBe(1);
    expect(rerun.agenda.occurrences[0]!.title).toBe("Organizer edited title");
    expect((await listAgendaContents(env.DB, eventId, {})).contents[0]!.review).toMatchObject({
      reason: "source_changed",
      incoming: { title: "Source corrected title" },
    });
  });
});
