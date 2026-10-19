import type { DatabaseLike } from "../../types";
import { publicSponsorPublicationProjection } from "../public-sponsors";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import type { SponsorshipReadModelRow } from "./read-model";

/** Compare the canonical public projection before the guarded patch, including appearance and withdrawal. */
export function prepareSponsorshipContentPublication(
  db: DatabaseLike,
  existing: SponsorshipReadModelRow,
  next: Pick<SponsorshipReadModelRow, "non_member_name" | "non_member_website" | "tier" | "renewal_date">,
  at: string,
) {
  const before = publicSponsorPublicationProjection("sponsorships");
  const after = publicSponsorPublicationProjection("publication_sponsorships");
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "sponsorship",
      resourceId: existing.id,
      revision: Date.parse(at),
      reasonCode: "sponsorship_changed",
      deduplicationKey: `sponsorship-content:${existing.id}:${crypto.randomUUID()}`,
    },
    {
      sql: `EXISTS(SELECT 1 FROM sponsorships publication_subject
      WHERE publication_subject.id=?
      AND EXISTS(SELECT 1 FROM (SELECT NULL AS event_id UNION SELECT id AS event_id FROM events) publication_context
      WHERE (${before}) IS NOT (
        WITH publication_patch(id,non_member_name,non_member_website,tier,renewal_date,updated_at) AS (VALUES(?,?,?,?,?,?)),
        publication_sponsorships AS (
          SELECT original.id,original.sponsor_type,original.organization_id,original.event_id,
            original.pipeline_stage,original.transition_revision,original.non_member_logo_r2_key,original.ended_reason,
            CASE WHEN patch.id IS NULL THEN original.non_member_name ELSE patch.non_member_name END AS non_member_name,
            CASE WHEN patch.id IS NULL THEN original.non_member_website ELSE patch.non_member_website END AS non_member_website,
            CASE WHEN patch.id IS NULL THEN original.tier ELSE patch.tier END AS tier,
            CASE WHEN patch.id IS NULL THEN original.renewal_date ELSE patch.renewal_date END AS renewal_date,
            CASE WHEN patch.id IS NULL THEN original.updated_at ELSE patch.updated_at END AS updated_at
          FROM sponsorships original LEFT JOIN publication_patch patch ON patch.id=original.id
        ), publication_sponsorship_periods AS (
          SELECT period.id,period.sponsorship_id,period.tier,period.revision,period.started_at,period.ended_at,period.end_reason,period.recorded_at,
            CASE WHEN patch.id IS NOT NULL AND period.ended_at IS NULL
              THEN strftime('%Y-%m-%dT%H:%M:%fZ',patch.renewal_date) ELSE period.scheduled_end_at END AS scheduled_end_at
          FROM sponsorship_periods period LEFT JOIN publication_patch patch ON patch.id=period.sponsorship_id
        ) SELECT (${after}))))`,
      bindings: [
        existing.id,
        existing.id,
        next.non_member_name,
        next.non_member_website,
        next.tier,
        next.renewal_date,
        at,
      ],
    },
  );
}
