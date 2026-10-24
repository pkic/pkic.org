import { personProfileSlugBase } from "../assets/shared/schemas/public-page-slug";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { createAgendaOccurrence, publishAgenda } from "../functions/_lib/services/event-agenda/mutations";
import { previewAgenda } from "../functions/_lib/services/event-agenda/preview";
import { agendaOccurrenceCreateSchema } from "../assets/shared/schemas/event-agenda";
import { agendaContent } from "../assets/shared/public-agenda-content";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedSpeakerHistory, personProfileRedirects } from "../functions/_lib/services/site-session-history";

beforeEach(resetDb);

const description = "A substantial approved abstract describing this conference session in detail.";

async function seedSpeaker(id: string) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,?,?)")
    .bind(id, `${id}@example.test`, `${id}@example.test`, now, now)
    .run();
}

/** Create one public session per speaker, record each speaker's approved appearance, and approve the agenda. */
async function approveSessions(
  eventId: string,
  actorId: string,
  revision: number,
  credits: Array<{ userId: string; displayName: string; approvedAt: string }>,
) {
  let current = revision;
  for (const [index, credit] of credits.entries()) {
    const title = `Session ${revision}-${index}`;
    const agenda = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        title,
        description,
        visibility: "public",
        startAt: `2026-12-01T${String(9 + revision + index).padStart(2, "0")}:00:00.000Z`,
        endAt: `2026-12-01T${String(9 + revision + index).padStart(2, "0")}:45:00.000Z`,
        roomId: null,
        speakerUserIds: [credit.userId],
        expectedRevision: current,
      }),
      actorId,
    );
    current = agenda.revision;
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId: agenda.occurrences.find((item) => item.title === title)!.id,
      reviewerId: actorId,
      appearances: [individualAppearanceFixture(credit)],
    });
  }
  await publishAgenda(env.DB, eventId, "pqc-2026", current, actorId);
  return current + 1;
}

const profileLinks = (agenda: Awaited<ReturnType<typeof previewAgenda>>) =>
  agendaContent(agenda)
    .speakers.map((speaker) => speaker.personPath)
    .filter(Boolean)
    .sort();

describe("speaker profile publication", () => {
  it("resolves long approved-name collisions without exceeding D1 pattern limits", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    await seedSpeaker("long-speaker-a");
    await seedSpeaker("long-speaker-b");
    const name = "Alexandra Catherine van Example-Rivera certificate lifecycle and migration engineering";
    await approveSessions(eventId, admin.id, 0, [
      { userId: "long-speaker-a", displayName: name, approvedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    const current = await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
      .bind(eventId)
      .first<{ revision: number }>();
    await approveSessions(eventId, admin.id, current!.revision, [
      { userId: "long-speaker-b", displayName: name, approvedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    const rows = await env.DB.prepare(
      "SELECT slug FROM person_profile_slugs WHERE user_id IN('long-speaker-a','long-speaker-b') ORDER BY slug",
    ).all<{ slug: string }>();
    expect(rows.results.map((row) => row.slug)).toEqual([
      personProfileSlugBase(name),
      `${personProfileSlugBase(name)}-2`,
    ]);
  });
  it("links a profile only where the build renders it, following the event's live visibility", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    await seedSpeaker("speaker-a");
    await approveSessions(eventId, admin.id, 0, [
      { userId: "speaker-a", displayName: "Zoë Ångström", approvedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    expect(
      await env.DB.prepare("SELECT slug,retired_at FROM person_profile_slugs WHERE user_id='speaker-a'").all(),
    ).toMatchObject({ results: [{ slug: "zoe-angstrom", retired_at: null }] });

    // An invitation-only event's approved agenda reaches the portal but never the static site.
    const portalOnly = await previewAgenda(env.DB, eventId, "pqc-2026", "approved");
    expect(portalOnly.publicPages).toBe(false);
    expect(profileLinks(portalOnly)).toEqual([]);
    expect(agendaContent(portalOnly).days[0]!.slots[0]!.sessions[0]!.sessionUrl).toBeUndefined();
    expect(publishedSpeakerHistory(await readSitePublicationSnapshot(env.DB, []))).toEqual([]);

    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    const published = await previewAgenda(env.DB, eventId, "pqc-2026", "approved");
    const pages = publishedSpeakerHistory(await readSitePublicationSnapshot(env.DB, [])).map((person) => person.route);
    expect(profileLinks(published)).toEqual(["/people/zoe-angstrom/"]);
    expect(pages).toEqual(profileLinks(published));
  });

  it("keeps an address unique, stable across older approvals, and redirects it after an approved name change", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    await seedSpeaker("speaker-a");
    await seedSpeaker("speaker-b");
    const revision = await approveSessions(eventId, admin.id, 0, [
      { userId: "speaker-a", displayName: "Jane Doe", approvedAt: "2026-10-01T00:00:00.000Z" },
      { userId: "speaker-b", displayName: "Jane Doe", approvedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    const first = await previewAgenda(env.DB, eventId, "pqc-2026", "approved");
    expect(first.speakerProfileSlugs).toEqual({ "speaker-a": "jane-doe", "speaker-b": "jane-doe-2" });

    // An older approval of the old name never moves the address; a later approved name does.
    await env.DB.prepare("UPDATE person_profile_slugs SET created_at='2026-10-02T00:00:00.000Z'").run();
    await approveSessions(eventId, admin.id, revision, [
      { userId: "speaker-a", displayName: "Jane Smith", approvedAt: "2026-10-03T00:00:00.000Z" },
    ]);
    const renamed = await previewAgenda(env.DB, eventId, "pqc-2026", "approved");
    expect(renamed.speakerProfileSlugs).toEqual({ "speaker-a": "jane-smith", "speaker-b": "jane-doe-2" });
    const publication = await readSitePublicationSnapshot(env.DB, []);
    expect(personProfileRedirects(publication)).toEqual([
      { from: "/people/jane-doe/", to: "/people/jane-smith/", status: 301 },
    ]);
    // The retired address stays reserved for its person: nobody else is ever given it.
    await seedSpeaker("speaker-c");
    await approveSessions(eventId, admin.id, revision + 2, [
      { userId: "speaker-c", displayName: "Jane Doe", approvedAt: "2026-10-04T00:00:00.000Z" },
    ]);
    expect((await previewAgenda(env.DB, eventId, "pqc-2026", "approved")).speakerProfileSlugs?.["speaker-c"]).toBe(
      "jane-doe-3",
    );
  });
});
