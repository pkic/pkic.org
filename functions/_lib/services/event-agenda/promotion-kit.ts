import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { PROMOTION_TEMPLATE_VERSION } from "../../../../assets/shared/schemas/event-promotion-kit";
import { registrationPageUrl } from "../frontend-links";
import { getEventBySlug } from "../events";
import {
  promotionFormatSchema,
  promotionKitSchema,
  type PromotionCopy,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import type { DatabaseLike } from "../../types";
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { commitAgendaRevision } from "./mutations";
import { getAgenda, getAgendaOccurrence } from "./read";
import { createReferralCode } from "../referrals";
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
  const row = await first<{ snapshot_json: string; revision: number; copy_json: string | null }>(
    db,
    `SELECT p.snapshot_json,p.revision,k.copy_json FROM event_agenda_publications p JOIN event_agenda_state s ON s.event_id=p.event_id AND s.published_revision=p.revision LEFT JOIN event_agenda_promotion_copy k ON k.occurrence_id=? WHERE p.event_id=?`,
    [occurrenceId, eventId],
  );
  if (!row)
    throw new AppError(409, "AGENDA_NOT_PUBLISHED", "Approve this event agenda before generating promotion materials.");
  const agenda = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  const occurrence = agenda.occurrences.find(
    (item) => item.id === occurrenceId && item.visibility === "public" && item.kind !== "break",
  );
  if (!occurrence) throw new AppError(404, "PUBLIC_SESSION_NOT_FOUND", "This session is not available for promotion.");
  if (!occurrence.promotionCopy)
    throw new AppError(409, "PROMOTION_COPY_UNAPPROVED", "Review promotion copy and approve the agenda first.");
  const copy = occurrence.promotionCopy;
  if (!copy.approvedAt)
    throw new AppError(409, "PROMOTION_COPY_UNAPPROVED", "Review and approve the promotion copy first.");
  const registration = await first<{ id: string }>(
    db,
    "SELECT id FROM registrations WHERE event_id=? AND user_id=? LIMIT 1",
    [eventId, actorId],
  );
  const existing = registration
    ? await first<{ code: string }>(
        db,
        "SELECT code FROM referral_codes WHERE event_id=? AND owner_type='registration' AND owner_id=? AND channel_hint=? LIMIT 1",
        [eventId, registration.id, copy.campaign],
      )
    : null;
  const code = registration
    ? (existing?.code ??
      (await createReferralCode(db, {
        eventId,
        ownerType: "registration",
        ownerId: registration.id,
        createdByUserId: actorId,
        channelHint: copy.campaign,
        length: 10,
      })))
    : undefined;
  const event = await getEventBySlug(db, agenda.eventSlug);
  const registrationUrl = code
    ? new URL(`/r/${encodeURIComponent(code)}`, origin).toString()
    : registrationPageUrl(origin, event, { source: copy.campaign });
  const downloads = await first<{ count: number }>(
    db,
    "SELECT COALESCE(SUM(download_count),0) AS count FROM event_agenda_promotion_downloads WHERE occurrence_id=? AND user_id=?",
    [occurrenceId, actorId],
  );
  const referral =
    code && registration
      ? await first<{ clicks: number; confirmedRegistrations: number }>(
          db,
          `SELECT referral.clicks,
          (SELECT COUNT(*) FROM referral_conversions conversion
           JOIN registrations converted ON converted.id=conversion.conversion_ref
           WHERE conversion.code=referral.code AND conversion.conversion_type='registration'
             AND converted.event_id=referral.event_id AND converted.status='registered') AS confirmedRegistrations
         FROM referral_codes referral
         WHERE referral.code=? AND referral.event_id=?
           AND referral.owner_type='registration' AND referral.owner_id=?`,
          [code, eventId, registration.id],
        )
      : null;
  const rsvps = await first<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM agenda_session_participations WHERE occurrence_id=? AND event_id=? AND status = 'reserved'",
    [occurrenceId, eventId],
  );
  const artifacts = await all<{ format: string; status: string; attempts: number }>(
    db,
    "SELECT format,status,attempts FROM event_agenda_promotion_render_jobs WHERE occurrence_id=? AND user_id=? AND revision=? AND cache_key LIKE ? ORDER BY format LIMIT 5",
    [occurrenceId, actorId, row.revision, `promotion/v${PROMOTION_TEMPLATE_VERSION}/%`],
  );
  const kit = promotionKitSchema.parse({
    occurrenceId,
    publishedRevision: row.revision,
    templateVersion: PROMOTION_TEMPLATE_VERSION,
    copy,
    formats: promotionFormatSchema.options,
    registrationUrl,
    sessionUrl: new URL(
      `/events/${encodeURIComponent(agenda.eventSlug)}/sessions/${encodeURIComponent(occurrenceId)}/`,
      origin,
    ).href,
    stale: false,
    artifacts,
    metrics: {
      downloads: downloads?.count ?? 0,
      clicks: referral?.clicks ?? 0,
      confirmedRegistrations: referral?.confirmedRegistrations ?? 0,
      sessionRsvps: rsvps?.count ?? 0,
    },
  });
  return { kit, agenda, occurrence, actorId };
}
