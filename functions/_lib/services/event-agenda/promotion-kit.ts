import { promotionKitProgress } from "./promotion-render-status";
import { readPromotionComposition } from "./promotion-composition";
import { resolvePromotionDesign } from "./promotion-design";
import { readAgendaSpeakers } from "./speaker-profiles";
import { agendaOccurrenceMedia } from "../../../../assets/shared/event-agenda-media";
import { sha256Hex } from "../../utils/crypto";
import { eventPublishesPages, publishedSessionRoute } from "../../../../assets/shared/public-agenda-pages";
import { withSessionPageSlugs } from "./session-page-slugs";
import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { PROMOTION_TEMPLATE_VERSION } from "../../../../assets/shared/schemas/event-promotion-kit";
import { promotionReferral } from "./promotion-referral";
import {
  promotionFormatSchema,
  promotionKitSchema,
  type PromotionCopy,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { commitAgendaRevision } from "./mutations";
import { getAgenda, getAgendaOccurrence } from "./read";

export async function savePromotionCopy(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  occurrenceId: string,
  revision: number,
  copy: PromotionCopy,
  actorId: string,
) {
  await getAgendaOccurrence(db, eventId, occurrenceId);
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [
      db
        .prepare(
          "INSERT INTO event_agenda_promotion_copy(occurrence_id,copy_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET copy_json=excluded.copy_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        )
        .bind(occurrenceId, JSON.stringify(copy), actorId, nowIso()),
    ],
    actorId,
  );
  return getAgenda(db, eventId, eventSlug);
}
export async function getPromotionKit(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actorId: string,
  origin: string,
) {
  const row = await first<{ snapshot_json: string; revision: number }>(
    db,
    `SELECT p.snapshot_json,p.revision FROM event_agenda_publications p JOIN event_agenda_state s ON s.event_id=p.event_id AND s.published_revision=p.revision WHERE p.event_id=?`,
    [eventId],
  );
  if (!row)
    throw new AppError(409, "AGENDA_NOT_PUBLISHED", "Approve this event agenda before generating promotion materials.");
  const agenda = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  const occurrence = agenda.occurrences.find(
    (item) => item.id === occurrenceId && item.visibility === "public" && item.kind !== "break",
  );
  if (!occurrence) throw new AppError(404, "PUBLIC_SESSION_NOT_FOUND", "This session is not available for promotion.");
  const approvedCopy = occurrence.promotionCopy?.approvedAt ? occurrence.promotionCopy : null;
  const copy = approvedCopy ?? {
    whyAttend: occurrence.description,
    takeaways: [],
    callToAction: "Register for this event",
    campaign: "speaker-kit",
    approvedAt: null,
  };
  const code = await promotionReferral(db, eventId, actorId);
  const personal = await readPromotionComposition(db, eventId, actorId, occurrenceId);
  const visual = await resolvePromotionDesign(db, eventId);
  const event = visual.event;
  if (personal.revision === 0) personal.composition.panels = [...visual.design.panels];
  const candidates = (await readAgendaSpeakers(db, eventId, [occurrenceId])).get(occurrenceId) ?? [];
  const approvedIds = new Set(occurrence.speakers.map((person) => person.userId));
  const people = candidates
    .filter((person) => approvedIds.has(person.userId))
    .sort(
      (a, b) =>
        occurrence.speakers.findIndex((p) => p.userId === a.userId) -
        occurrence.speakers.findIndex((p) => p.userId === b.userId),
    )
    .map((person) => ({
      userId: person.userId,
      displayName: person.displayName,
      affiliation: (person.profileCandidates ?? (person.profileCandidate ? [person.profileCandidate] : []))
        .map((identity) => [identity.jobTitle, identity.organizationName].filter(Boolean).join(" · "))
        .filter(Boolean)
        .join("; "),
      photoUrl: person.profileCandidate?.photoUrl ?? null,
      role: person.role ?? "speaker",
    }));
  const media = agendaOccurrenceMedia(agenda.rooms, occurrence);
  const mediaWording = visual.design.advertiseLiveStreaming && media.liveStreaming ? "In person and online" : undefined;

  const registrationUrl = new URL(`/r/${encodeURIComponent(code)}`, origin).href;
  // The same page rule as every other link: only a session page the site renders is promoted.
  const sessionPage = publishedSessionRoute(
    await withSessionPageSlugs(db, eventId, {
      ...agenda,
      publicPages: eventPublishesPages(event?.visibility ?? "invitation_only"),
    }),
    occurrence,
  );
  const kit = promotionKitSchema.parse({
    occurrenceId,
    source: { title: occurrence.title, description: occurrence.description },
    publishedRevision: row.revision,
    templateVersion: PROMOTION_TEMPLATE_VERSION,
    copy,
    formats: promotionFormatSchema.options,
    registrationUrl,
    ...(sessionPage ? { sessionUrl: new URL(sessionPage, origin).href } : {}),
    audience: "speaker",
    composition: personal.composition,
    compositionRevision: personal.revision,
    stale: false,
    artifacts: [],
    metrics: { downloads: 0, clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
  });
  const source = {
    kit,
    agenda,
    occurrence,
    actorId,
    audience: "speaker" as const,
    composition: personal.composition,
    design: visual.design,
    place: visual.place,
    people,
    mediaWording,
  };
  kit.fingerprint = await sha256Hex(
    JSON.stringify({
      agenda,
      occurrence,
      people,
      composition: personal,
      design: visual.design,
      brandingRevision: visual.brandingRevision,
      place: visual.place,
      mediaWording,
      registrationUrl,
    }),
  );
  Object.assign(kit, await promotionKitProgress(db, eventId, actorId, occurrenceId, kit.fingerprint!, code));
  return source;
}
