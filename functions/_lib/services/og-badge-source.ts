import { preparePromotionDesign } from "./event-agenda/promotion-design";
/** Resolve personal promotion facts and cache freshness in one complete request batch. */
import { PERSONAL_PROMOTION_RENDERER } from "../../../assets/shared/personal-promotion-image";
import type { CountryCode } from "../../../assets/shared/countries";
import type { DatabaseLike } from "../types";
import { batchFirst } from "../db/pagination";
import { proposalSpeakerProfileColumns } from "./proposal-speakers";
import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "./registrations/selected-identity";
import {
  selectedOrAffiliationOrganizationNameSql,
  selectedOrAffiliationJobTitleSql,
} from "./identities/affiliation-projection";

export interface BadgeSource {
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  headshot_r2_key: string | null;
  event_name: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  settings_json: string;
  city: string | null;
  country: CountryCode | null;
  role: string;
  requested_generation: number;
  event_revision: string;
  promotion?: Awaited<ReturnType<ReturnType<typeof preparePromotionDesign>["decode"]>>;
}

export async function readBadgeSource(db: DatabaseLike, code: string): Promise<BadgeSource | null> {
  const visual = preparePromotionDesign(db, { referralCode: code });
  const [result, ...design] = await db.batch([
    db
      .prepare(`
    SELECT ${proposalSpeakerProfileColumns("u", "ps", "", ["firstName", "lastName"])},
      CASE rc.owner_type WHEN 'registration' THEN ${REGISTRATION_ORGANIZATION_SQL}
        ELSE ${selectedOrAffiliationOrganizationNameSql("ps.acting_identity_id", "u.id")} END AS organization_name,
      CASE rc.owner_type WHEN 'registration' THEN ${REGISTRATION_JOB_TITLE_SQL}
        ELSE ${selectedOrAffiliationJobTitleSql("ps.acting_identity_id", "u.id")} END AS job_title,
      u.headshot_r2_key, e.name AS event_name, e.starts_at, e.ends_at, e.timezone,
      e.settings_json, e.city, e.country, e.updated_at AS event_revision,
      CASE rc.owner_type WHEN 'proposal' THEN COALESCE(ps.role,'speaker')
        ELSE COALESCE(bro.role,(
          SELECT ep.role FROM event_participant_badge_roles ep
          WHERE ep.event_id=r.event_id AND ep.user_id=r.user_id
          ORDER BY ep.priority ASC,ep.role ASC LIMIT 1
        ),'attendee') END AS role,
      COALESCE(job.requested_generation,0) AS requested_generation
    FROM referral_codes rc
    JOIN events e ON e.id=rc.event_id
    LEFT JOIN registrations r ON rc.owner_type='registration' AND r.id=rc.owner_id
    LEFT JOIN session_proposals sp ON rc.owner_type='proposal' AND sp.id=rc.owner_id AND sp.deleted_at IS NULL
    JOIN users u ON u.id=CASE rc.owner_type WHEN 'registration' THEN r.user_id ELSE rc.created_by_user_id END
    LEFT JOIN proposal_speakers ps ON rc.owner_type='proposal' AND ps.proposal_id=sp.id AND ps.user_id=u.id
    LEFT JOIN registration_badge_role_overrides bro ON bro.registration_id=r.id
    LEFT JOIN badge_render_jobs job ON job.referral_code=rc.code
    WHERE rc.code=? AND (r.id IS NOT NULL OR sp.id IS NOT NULL)
    LIMIT 1`)
      .bind(code),
    ...visual.statements,
  ]);
  const source = batchFirst<BadgeSource>(result);
  if (!source) return null;
  source.promotion = await visual.decode(design);
  return source;
}

/** Old-layout cache objects never satisfy the shared promotion renderer's identity. */
export function personalBadgeCacheMetadata(code: string, source: BadgeSource): Record<string, string> {
  return {
    referralCode: code,
    badgeGeneration: String(source.requested_generation),
    badgeRenderer: PERSONAL_PROMOTION_RENDERER,
    badgeDesignRevision: source.promotion?.brandingRevision ?? source.event_revision,
  };
}
