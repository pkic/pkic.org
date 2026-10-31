import { personalPromotionSharePath } from "../../../../assets/shared/personal-promotion-image";
import type { PromotionSourceBasis } from "./promotion-source-read";
import { agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import {
  promotionKitSchema,
  promotionFormatSchema,
  PROMOTION_TEMPLATE_VERSION,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import { sha256Hex } from "../../utils/crypto";
import { AppError } from "../../errors";
import { publicUserHeadshotPath } from "../user-headshot";
export async function buildAttendeePromotionSource(basis: PromotionSourceBasis, userId: string, origin: string) {
  if (!basis.registered)
    throw new AppError(
      403,
      "PROMOTION_REGISTRATION_REQUIRED",
      "Promotion materials are available to registered attendees.",
    );
  const { visual, personal, agenda, person, code } = basis;
  if (!person) throw new AppError(403, "PROMOTION_PERSON_UNAVAILABLE", "Your profile is unavailable.");
  const available = agenda.occurrences.filter((item) => item.visibility === "public" && item.kind !== "break");
  const picks = personal.composition.sessionIds.map((id) => available.find((item) => item.id === id));
  const availablePicks = picks.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const stale = availablePicks.length !== picks.length;
  const composition = { ...personal.composition, sessionIds: availablePicks.map((item) => item.id) };
  if (!code)
    throw new AppError(
      409,
      "PROMOTION_REFERRAL_REQUIRED",
      "Prepare your personal promotion link before loading these materials.",
    );
  const registrationUrl = new URL(personalPromotionSharePath(code), origin).href;
  const occurrence = agendaOccurrenceSchema.parse({
    id: `event:${visual.event.id}`,
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
  const kit = promotionKitSchema.parse({
    occurrenceId: null,
    source: { title: occurrence.title, description: occurrence.description },
    audience: "attendee",
    publishedRevision: Math.max(1, agenda.publishedRevision ?? 0),
    templateVersion: PROMOTION_TEMPLATE_VERSION,
    copy,
    composition,
    compositionRevision: personal.revision,
    fingerprint,
    formats: promotionFormatSchema.options,
    registrationUrl,
    stale,
    artifacts: [],
    metrics: { clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
  });
  kit.metrics = basis.metrics;
  kit.artifacts = stale ? [] : basis.artifacts(fingerprint);
  return {
    kit,
    agenda,
    occurrence,
    actorId: userId,
    audience: "attendee" as const,
    composition,
    design: visual.design,
    place: visual.place,
    people,
    picks: availablePicks,
  };
}
