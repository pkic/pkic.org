import { personalPromotionSharePath } from "../../../../assets/shared/personal-promotion-image";
import type { PromotionSourceBasis } from "./promotion-source-read";
import { promotionMediaWording } from "../../../../assets/shared/promotion-media";
import { agendaOccurrenceMedia } from "../../../../assets/shared/event-agenda-media";
import { sha256Hex } from "../../utils/crypto";
import { eventPublishesPages, publishedSessionRoute } from "../../../../assets/shared/public-agenda-pages";
import {
  PROMOTION_TEMPLATE_VERSION,
  promotionFormatSchema,
  promotionKitSchema,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import { AppError } from "../../errors";
export async function buildSpeakerPromotionSource(basis: PromotionSourceBasis, actorId: string, origin: string) {
  const { agenda, code, personal, visual } = basis;
  const occurrenceId = basis.occurrenceId!;
  const occurrence = agenda.occurrences.find(
    (item) => item.id === occurrenceId && item.visibility === "public" && item.kind !== "break",
  );
  if (!occurrence) throw new AppError(404, "PUBLIC_SESSION_NOT_FOUND", "This session is not available for promotion.");
  if (!code)
    throw new AppError(
      409,
      "PROMOTION_REFERRAL_REQUIRED",
      "Prepare your personal promotion link before loading these materials.",
    );
  const approvedCopy = occurrence.promotionCopy?.approvedAt ? occurrence.promotionCopy : null;
  const copy = approvedCopy ?? {
    whyAttend: occurrence.description,
    takeaways: [],
    callToAction: "Register for this event",
    campaign: "speaker-kit",
    approvedAt: null,
  };
  const event = visual.event;
  if (personal.revision === 0) personal.composition.panels = [...visual.design.panels];
  const candidates = basis.people;
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
  const mediaWording = promotionMediaWording(visual.design, media, occurrence.recordingUrl);

  const registrationUrl = new URL(personalPromotionSharePath(code), origin).href;
  // The same page rule as every other link: only a session page the site renders is promoted.
  const sessionPage = publishedSessionRoute(
    { ...agenda, publicPages: eventPublishesPages(event.visibility) },
    occurrence,
  );
  const kit = promotionKitSchema.parse({
    occurrenceId,
    source: {
      title: occurrence.title,
      description: occurrence.description,
      media: {
        recording: media.recording,
        liveStreaming: media.liveStreaming,
        inherited: media.inherited,
        recordingAvailable: media.recording && Boolean(occurrence.recordingUrl),
      },
    },
    publishedRevision: basis.publishedRevision!,
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
    metrics: { clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
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
  kit.metrics = basis.metrics;
  kit.artifacts = basis.artifacts(kit.fingerprint!);
  return source;
}
