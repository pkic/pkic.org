import { agendaAffiliationContent } from "../../../../assets/shared/agenda-speaker-affiliations";
import type { AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import type { SessionAffiliation } from "../../../../assets/shared/schemas/event-session-history";
import type { PromotionMeasure, PromotionText } from "./promotion-scene";
import { promotionMeasuredLines, promotionEllipsisLines } from "./promotion-text";

/** Carry the live identity fields intact so typography never guesses at punctuation in profile text. */
export function promotionIdentityAffiliations(person: AgendaOccurrence["speakers"][number]): SessionAffiliation[] {
  return (person.profileCandidates ?? (person.profileCandidate ? [person.profileCandidate] : [])).map((identity) => ({
    identityId: identity.identityId,
    title: identity.jobTitle,
    organizationId: identity.organizationId ?? null,
    organizationName: identity.organizationName,
  }));
}

/** One secondary-credit hierarchy for featured speakers, grids, and standalone images. */
export function layoutPromotionSpeakerCredit(
  person: { affiliation: string; affiliations?: readonly SessionAffiliation[] },
  width: number,
  size: number,
  measure: PromotionMeasure,
  maxLinesPerField = Infinity,
) {
  const fields = person.affiliations?.flatMap((affiliation) => {
    const content = agendaAffiliationContent(undefined, affiliation);
    return [
      ...(content.title ? [{ value: content.title, size, weight: 500 as const, color: "#ffffff" }] : []),
      ...(content.organization
        ? [{ value: content.organization.name, size: size * 0.88, weight: 400 as const, color: "#d8e2df" }]
        : []),
    ];
  });
  const blocks = fields?.length
    ? fields
    : [{ value: person.affiliation, size, weight: 400 as const, color: "#ffffff" }];
  const lines: (PromotionText & { y: number })[] = [];
  let height = 0;
  for (const field of blocks) {
    const fieldWidth = (text: string) => measure(text, field.size, false, false, field.weight);
    const wrapped = promotionEllipsisLines(
      promotionMeasuredLines(field.value, width, fieldWidth),
      maxLinesPerField,
      width,
      fieldWidth,
    );
    if (!wrapped.length) continue;
    if (height) height += size * 0.18;
    const leading = field.size * 1.3;
    const metrics = measure.metrics?.(field.size, false, false, field.weight) ?? {
      ascent: field.size * 0.93,
      descent: -field.size * 0.24,
      lineGap: 0,
    };
    const baseline = metrics.ascent + (leading - metrics.ascent + metrics.descent) / 2;
    for (const text of wrapped) {
      lines.push({
        text,
        x: 0,
        y: height + baseline,
        size: field.size,
        bold: false,
        weight: field.weight,
        color: field.color,
        role: "P",
      });
      height += leading;
    }
  }
  return { lines, height, size };
}
