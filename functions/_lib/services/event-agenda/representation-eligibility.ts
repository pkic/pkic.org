import type { AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { appearanceIdentityIds, type SessionAppearance } from "../../../../assets/shared/schemas/event-session-history";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { ownedIdentityLifecycleSql } from "../identities/selection";

type RepresentationReference = { userId: string; actingIdentityId: string | null; at: string | null };

/** Proposal provenance is a suggestion until an editor explicitly approves each canonical credit. */
export function pendingProposalRepresentationApprovals(occurrence: AgendaOccurrence): string[] {
  return (occurrence.history?.proposalRepresentations ?? [])
    .filter((source) => occurrence.speakers.some((speaker) => speaker.userId === source.userId))
    .filter((source) => !occurrence.history?.appearances.some((appearance) => appearance.userId === source.userId))
    .map((source) => source.userId);
}

/** Editorial appearances take precedence over upstream suggestions, independent of credit role. */
export function occurrenceRepresentationReferences(
  occurrences: readonly AgendaOccurrence[],
): RepresentationReference[] {
  return occurrences.flatMap((occurrence) =>
    occurrence.speakers.flatMap((speaker) => {
      const appearance = occurrence.history?.appearances.find((item) => item.userId === speaker.userId);
      const source = occurrence.history?.proposalRepresentations.find((item) => item.userId === speaker.userId);
      const at = occurrence.startAt ?? occurrence.history?.archivalTiming?.startAt ?? null;
      return appearance
        ? appearanceRepresentationReferences(appearance, at)
        : [{ userId: speaker.userId, actingIdentityId: source?.actingIdentityId ?? null, at }];
    }),
  );
}

/** Every representation an approved appearance credits, each checked against the speaker and the session date. */
export function appearanceRepresentationReferences(
  appearance: SessionAppearance,
  at: string | null,
): RepresentationReference[] {
  const identities = appearanceIdentityIds(appearance);
  return (identities.length ? identities : [null]).map((actingIdentityId) => ({
    userId: appearance.userId,
    actingIdentityId,
    at,
  }));
}

/** One bounded read and one atomic guard cover the complete import or scheduling operation. */
export async function prepareRepresentationEligibility(
  db: DatabaseLike,
  references: readonly RepresentationReference[],
) {
  const read = prepareRepresentationEligibilityRead(db, references);
  return read.decode(read.statements.length ? await db.batch(read.statements) : []);
}

export function prepareRepresentationEligibilityRead(db: DatabaseLike, references: readonly RepresentationReference[]) {
  const selected = references.filter((item) => item.actingIdentityId !== null);
  const at = "json_extract(reference.value,'$.at')";
  const validity = `identity.id=json_extract(reference.value,'$.actingIdentityId')
    AND identity.user_id=json_extract(reference.value,'$.userId')
    AND ((${at} IS NULL AND ${ownedIdentityLifecycleSql("identity", null)})
      OR (${at} IS NOT NULL AND ${ownedIdentityLifecycleSql("identity", at)}))`;
  const invalid = `SELECT 1 FROM json_each(?) reference WHERE NOT EXISTS(SELECT 1 FROM identities identity WHERE ${validity})`;
  const bindings = [JSON.stringify(selected)];
  return {
    statements: selected.length ? [db.prepare(`SELECT 1 AS invalid WHERE EXISTS(${invalid})`).bind(...bindings)] : [],
    decode(loaded: D1StatementResult[]) {
      if (!selected.length) return [];
      if (batchFirst(loaded[0]))
        throw new AppError(
          422,
          "AGENDA_REPRESENTATION_IDENTITY_UNAVAILABLE",
          "Choose a representation owned by this person and valid at the session date.",
        );
      return [prepareAuthorizationGuard(db, { sql: `SELECT 1 WHERE NOT EXISTS(${invalid})`, bindings })];
    },
  };
}
