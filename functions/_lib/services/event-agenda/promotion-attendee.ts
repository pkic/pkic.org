import { promotionRenderStatus } from "./promotion-render-status";
import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import {
  promotionKitSchema,
  promotionFormatSchema,
  PROMOTION_TEMPLATE_VERSION,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import { resolvePromotionDesign } from "./promotion-design";
import { readPromotionComposition } from "./promotion-composition";
import { promotionReferral, promotionReferralMetrics } from "./promotion-referral";
import { first } from "../../db/queries";
import { sha256Hex } from "../../utils/crypto";
import { AppError } from "../../errors";
import { personDisplayNameSql } from "./speaker-name";
import { primaryIdentityIdSql, identityJobTitleSql } from "../identities/affiliation-projection";
import { publicUserHeadshotPath } from "../user-headshot";
import type { DatabaseLike } from "../../types";
export async function getAttendeePromotionKit(db: DatabaseLike, eventId: string, userId: string, origin: string) {
  const registered = await first<{ id: string }>(
    db,
    "SELECT id FROM registrations WHERE event_id=? AND user_id=? AND status='registered' LIMIT 1",
    [eventId, userId],
  );
  if (!registered)
    throw new AppError(
      403,
      "PROMOTION_REGISTRATION_REQUIRED",
      "Promotion materials are available to registered attendees.",
    );
  const visual = await resolvePromotionDesign(db, eventId),
    personal = await readPromotionComposition(db, eventId, userId, null);
  const row = await first<{ snapshot_json: string }>(
    db,
    "SELECT p.snapshot_json FROM event_agenda_publications p JOIN event_agenda_state s ON s.event_id=p.event_id AND s.published_revision=p.revision WHERE p.event_id=?",
    [eventId],
  );
  const agenda = storedAgendaSnapshotSchema.parse(
    row
      ? JSON.parse(row.snapshot_json)
      : {
          eventSlug: visual.event.slug,
          eventName: visual.event.name,
          timeZone: visual.event.timezone,
          revision: 0,
          publishedRevision: null,
          rooms: [],
          occurrences: [],
          shifts: [],
          roleMembers: [],
          assignments: [],
        },
  );
  const person = await first<{
    display_name: string;
    job_title: string | null;
    organization_name: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT ${personDisplayNameSql("person", "Attendee")} AS display_name,${identityJobTitleSql("identity.id")} AS job_title,organization.name AS organization_name,person.headshot_r2_key FROM users person LEFT JOIN identities identity ON identity.id=${primaryIdentityIdSql("person.id")} LEFT JOIN organizations organization ON organization.id=identity.organization_id WHERE person.id=? AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
    [userId],
  );
  if (!person) throw new AppError(403, "PROMOTION_PERSON_UNAVAILABLE", "Your profile is unavailable.");
  const available = agenda.occurrences.filter((item) => item.visibility === "public" && item.kind !== "break");
  const picks = personal.composition.sessionIds.map((id) => available.find((item) => item.id === id));
  if (picks.some((item) => !item))
    throw new AppError(
      409,
      "PROMOTION_SESSION_UNAVAILABLE",
      "A selected session is no longer public. Update your kit.",
    );
  const code = await promotionReferral(db, eventId, userId),
    registrationUrl = new URL(`/r/${encodeURIComponent(code)}`, origin).href;
  const occurrence = agendaOccurrenceSchema.parse({
    id: `event:${eventId}`,
    title: visual.event.name,
    description: "",
    startAt: visual.event.starts_at,
    endAt: visual.event.ends_at,
    roomId: null,
    speakers: [],
  });
  const copy = {
    whyAttend: `Join me at ${visual.event.name}.`,
    takeaways: [],
    callToAction: personal.composition.callToAction,
    campaign: "attendee-kit",
    approvedAt: null,
  };
  const people = [
    {
      userId,
      displayName: person.display_name,
      affiliation: [person.job_title, person.organization_name].filter(Boolean).join(" · "),
      photoUrl: publicUserHeadshotPath(userId, person.headshot_r2_key),
      role: "attendee",
    },
  ];
  const fingerprint = await sha256Hex(
    JSON.stringify({
      event: visual.event,
      design: visual.design,
      brandingRevision: visual.brandingRevision,
      personal,
      people,
      picks,
      registrationUrl,
    }),
  );
  const referral = await promotionReferralMetrics(db, eventId, userId, code);
  const downloads = await first<{ count: number }>(
    db,
    "SELECT COALESCE(SUM(download_count),0) AS count FROM event_promotion_renders WHERE event_id=? AND user_id=? AND occurrence_id IS NULL",
    [eventId, userId],
  );
  const kit = promotionKitSchema.parse({
    occurrenceId: null,
    source: { title: occurrence.title, description: occurrence.description },
    audience: "attendee",
    publishedRevision: Math.max(1, agenda.publishedRevision ?? 0),
    templateVersion: PROMOTION_TEMPLATE_VERSION,
    copy,
    composition: personal.composition,
    compositionRevision: personal.revision,
    fingerprint,
    formats: promotionFormatSchema.options,
    registrationUrl,
    stale: false,
    artifacts: [],
    metrics: {
      downloads: downloads?.count ?? 0,
      clicks: referral.clicks,
      confirmedRegistrations: referral.confirmedRegistrations,
      sessionRsvps: 0,
    },
  });
  kit.artifacts = await promotionRenderStatus(db, eventId, userId, null, fingerprint);
  return {
    kit,
    agenda,
    occurrence,
    actorId: userId,
    audience: "attendee" as const,
    composition: personal.composition,
    design: visual.design,
    place: visual.place,
    people,
    picks: picks.filter((item): item is NonNullable<typeof item> => Boolean(item)),
  };
}
