import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import {
  createAgendaOccurrence,
  patchAgendaOccurrence,
  publishAgenda,
} from "../functions/_lib/services/event-agenda/mutations";
import { previewAgenda } from "../functions/_lib/services/event-agenda/preview";
import { agendaOccurrenceCreateSchema, agendaOccurrencePatchSchema } from "../assets/shared/schemas/event-agenda";
import { agendaContent } from "../assets/shared/public-agenda-content";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedSessionHistory, sessionPageRedirects } from "../functions/_lib/services/site-session-history";

beforeEach(resetDb);

const description = "A substantial approved abstract describing this conference session in detail.";

async function addSession(eventId: string, actorId: string, expectedRevision: number, title: string, hour: number) {
  return createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      title,
      description,
      visibility: "public",
      startAt: `2026-12-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
      endAt: `2026-12-01T${String(hour).padStart(2, "0")}:45:00.000Z`,
      roomId: null,
      expectedRevision,
    }),
    actorId,
  );
}
const sessionUrls = async (eventId: string) =>
  agendaContent(await previewAgenda(env.DB, eventId, "pqc-2026", "approved")).days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.sessions.map((session) => session.sessionUrl)),
  );

describe("session page addresses", () => {
  it("issues readable addresses from approved titles and redirects every former address to the current page", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    await addSession(eventId, admin.id, 0, "Post-Quantum Migration: Lessons Learned", 9);
    const agenda = await addSession(eventId, admin.id, 1, "Post-quantum migration — lessons learned!", 10);
    await publishAgenda(env.DB, eventId, "pqc-2026", 2, admin.id);
    const [first, second] = [...agenda.occurrences].sort((a, b) => a.startAt!.localeCompare(b.startAt!));
    // Unique within the event, in a deterministic order.
    const issued = (await previewAgenda(env.DB, eventId, "pqc-2026", "approved")).sessionSlugs;
    expect(Object.values(issued ?? {}).sort()).toEqual([
      "post-quantum-migration-lessons-learned",
      "post-quantum-migration-lessons-learned-2",
    ]);
    const firstSlug = issued![first!.id]!;

    // A draft title change keeps the published address; its approval moves it and the old one redirects.
    await patchAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      first!.id,
      agendaOccurrencePatchSchema.parse({ expectedRevision: 3, title: "Hybrid certificates in production" }),
    );
    expect((await previewAgenda(env.DB, eventId, "pqc-2026", "approved")).sessionSlugs?.[first!.id]).toBe(firstSlug);
    await publishAgenda(env.DB, eventId, "pqc-2026", 4, admin.id);
    expect(await sessionUrls(eventId)).toContain("/events/pqc-2026/sessions/hybrid-certificates-in-production/");

    const publication = await readSitePublicationSnapshot(env.DB, []);
    const pages = publishedSessionHistory(publication).map((item) => item.route);
    expect(pages).toContain("/events/pqc-2026/sessions/hybrid-certificates-in-production/");
    expect(sessionPageRedirects(publication)).toEqual(
      expect.arrayContaining([
        {
          from: `/events/pqc-2026/sessions/${firstSlug}/`,
          to: "/events/pqc-2026/sessions/hybrid-certificates-in-production/",
          status: 301,
        },
        {
          from: `/events/pqc-2026/sessions/${first!.id}/`,
          to: "/events/pqc-2026/sessions/hybrid-certificates-in-production/",
          status: 301,
        },
        {
          from: `/events/pqc-2026/sessions/${second!.id}/`,
          to: `/events/pqc-2026/sessions/${issued![second!.id]}/`,
          status: 301,
        },
      ]),
    );
    for (const redirect of sessionPageRedirects(publication)) expect(pages).toContain(redirect.to);

    // The retired address stays with its session: a new session with that title gets another one.
    await addSession(eventId, admin.id, 5, "Post-Quantum Migration: Lessons Learned", 11);
    await publishAgenda(env.DB, eventId, "pqc-2026", 6, admin.id);
    const slugs = Object.values((await previewAgenda(env.DB, eventId, "pqc-2026", "approved")).sessionSlugs ?? {});
    expect(slugs).toContain("post-quantum-migration-lessons-learned-3");
    expect(slugs).not.toContain(firstSlug);
  });
});
