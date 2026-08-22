import type { MemberWallEntry } from "../../../../assets/shared/schemas/members-directory";
import { sanitizeLegacyHttpOrSameOriginUrl } from "../../../../assets/shared/schemas/urls";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { PUBLIC_SPONSOR_READ_MODEL_SQL } from "../public-sponsors";

interface MemberWallRow extends Omit<MemberWallEntry, "href" | "logoUrl"> {
  href: string | null;
  logoUrl: string | null;
}

/**
 * Unified public wall read model. Membership eligibility, logo presence,
 * sponsor attribution, non-member sponsor inclusion, and the final display cap
 * are all resolved in D1; the browser receives display-ready entries.
 */
export async function listMemberWall(db: DatabaseLike, memberLimit: number): Promise<MemberWallEntry[]> {
  const rows = await all<MemberWallRow>(
    db,
    `${PUBLIC_SPONSOR_READ_MODEL_SQL},
     active_member_organizations AS (
       SELECT DISTINCT o.id, o.slug, o.name, o.website, o.slogan, o.logo_r2_key
         FROM members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.status = 'active'
          AND o.logo_r2_key IS NOT NULL
     ), member_entries AS (
       SELECT 'member:' || member.id AS key,
              CASE WHEN member.slug IS NOT NULL
                   THEN '/members/' || member.slug || '/'
                   ELSE '/members/profile/?id=' || member.id END AS href,
              '/api/v1/members/' || member.id || '/logo' AS logoUrl,
              member.name,
              member.slogan,
              COALESCE(sponsor.effective_weight, 0) AS sponsorLevel,
              sponsor.effective_tier AS sponsorLevelName
         FROM active_member_organizations member
         LEFT JOIN enriched_sponsors sponsor ON sponsor.id = member.id
     ), sponsor_only_entries AS (
       SELECT 'sponsor:' || sponsor.id AS key,
              sponsor.website AS href,
              CASE WHEN sponsor.logo_r2_key IS NOT NULL
                   THEN '/api/v1/members/' || sponsor.id || '/logo'
                   ELSE '/api/v1/sponsors/' || sponsor.id || '/logo' END AS logoUrl,
              sponsor.name,
              NULL AS slogan,
              sponsor.effective_weight AS sponsorLevel,
              sponsor.effective_tier AS sponsorLevelName
         FROM enriched_sponsors sponsor
        WHERE sponsor.effective_weight > 0
          AND (sponsor.logo_r2_key IS NOT NULL OR sponsor.sponsorship_logo_r2_key IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM active_member_organizations member WHERE member.id = sponsor.id)
     ), selected_entries AS (
       SELECT key, href, logoUrl, name, slogan, sponsorLevel, sponsorLevelName
         FROM member_entries
       UNION ALL
       SELECT key, href, logoUrl, name, slogan, sponsorLevel, sponsorLevelName
         FROM sponsor_only_entries
     ), ranked_entries AS (
       SELECT selected_entries.key, selected_entries.href, selected_entries.logoUrl,
              selected_entries.name, selected_entries.slogan, selected_entries.sponsorLevel,
              selected_entries.sponsorLevelName,
              ROW_NUMBER() OVER (
                ORDER BY CASE WHEN sponsorLevel > 0 THEN 0 ELSE 1 END,
                         ((length(key) * 31 + unicode(substr(key, -1)) * 17 + unicode(substr(key, 8, 1))) % 997),
                         key
              ) AS display_rank
         FROM selected_entries
     )
     SELECT key, href, logoUrl, name, slogan, sponsorLevel, sponsorLevelName
       FROM ranked_entries
      WHERE display_rank <= ?
      ORDER BY display_rank`,
    ["", memberLimit],
  );

  return rows.map((row) => ({
    ...row,
    href: sanitizeLegacyHttpOrSameOriginUrl(row.href) ?? (row.key.startsWith("sponsor:") ? "/sponsors/" : "/members/"),
    logoUrl: sanitizeLegacyHttpOrSameOriginUrl(row.logoUrl) ?? "/img/logo.svg",
  }));
}
