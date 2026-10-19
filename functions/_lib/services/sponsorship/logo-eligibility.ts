import { SPONSOR_LOGO_GRACE_DAYS, SPONSOR_LOGO_GRACE_TIERS } from "../../../../assets/shared/sponsorship-logo-policy";

/** Trusted SQL fragments; one policy serves public lists, image access, and publication. */
export const sponsorLogoGraceTiersSql = SPONSOR_LOGO_GRACE_TIERS.map((tier) => `'${tier}'`).join(",");
export const sponsorLogoGraceDeadlineSql = (endSql: string) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ',${endSql},'+${SPONSOR_LOGO_GRACE_DAYS} days')`;

/** selected_event is empty for the general wall; ended events use period facts. */
export function consortiumLogoCandidatesSql(source: "sponsorships" | "publication_sponsorships"): string {
  const periods = source === "publication_sponsorships" ? "publication_sponsorship_periods" : "sponsorship_periods";
  return `SELECT sp.id AS sponsorship_id,sp.organization_id,sp.tier,
      0 AS logo_priority,sp.updated_at AS logo_order,sp.transition_revision AS logo_revision
    FROM ${source} sp CROSS JOIN sponsor_clock WHERE sp.sponsor_type='consortium' AND sp.pipeline_stage='active' AND sp.ended_reason IS NULL
      AND (sp.renewal_date IS NULL OR sp.renewal_date>substr(sponsor_clock.at,1,10))
      AND NOT EXISTS(SELECT 1 FROM selected_event WHERE ends_at<=sponsor_clock.at)
    UNION ALL
    SELECT sp.id,sp.organization_id,period.tier,1,period.started_at,period.revision
    FROM ${source} sp CROSS JOIN sponsor_clock JOIN ${periods} period ON period.sponsorship_id=sp.id
    WHERE sp.sponsor_type='consortium'
      AND ((sp.pipeline_stage='lapsed' AND sp.ended_reason='ordinary_expiry' AND period.end_reason='ordinary_expiry')
        OR (sp.pipeline_stage='active' AND sp.ended_reason IS NULL AND sp.renewal_date<=substr(sponsor_clock.at,1,10) AND period.ended_at IS NULL))
      AND period.tier IN (${sponsorLogoGraceTiersSql})
      AND period.scheduled_end_at<=sponsor_clock.at
      AND ${sponsorLogoGraceDeadlineSql("period.scheduled_end_at")}>sponsor_clock.at
      AND NOT EXISTS(SELECT 1 FROM selected_event)
      AND NOT EXISTS(SELECT 1 FROM ${periods} newer WHERE newer.sponsorship_id=sp.id
        AND (newer.started_at>period.started_at OR (newer.started_at=period.started_at AND newer.revision>period.revision)))
      AND NOT EXISTS(SELECT 1 FROM sponsorships renewed JOIN ${periods} newer ON newer.sponsorship_id=renewed.id
        WHERE sp.organization_id IS NOT NULL AND renewed.organization_id=sp.organization_id
          AND renewed.sponsor_type='consortium' AND renewed.id<>sp.id
          AND newer.started_at>=COALESCE(period.ended_at,period.scheduled_end_at))
    UNION ALL
    SELECT sp.id,sp.organization_id,period.tier,0,period.started_at,period.revision
    FROM ${source} sp CROSS JOIN sponsor_clock JOIN ${periods} period ON period.sponsorship_id=sp.id
      JOIN selected_event e ON e.ends_at<=sponsor_clock.at
    WHERE sp.sponsor_type='consortium'
      AND (sp.ended_reason IS NULL OR sp.ended_reason='ordinary_expiry')
      AND (period.end_reason IS NULL OR period.end_reason IN ('ordinary_expiry','tier_change'))
      AND period.started_at<e.ends_at
      AND COALESCE(period.ended_at,'9999')>COALESCE(e.starts_at,e.ends_at)
      AND COALESCE(period.scheduled_end_at,'9999')>COALESCE(e.starts_at,e.ends_at)`;
}
