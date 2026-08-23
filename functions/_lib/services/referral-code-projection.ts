/**
 * Deterministically projects the first referral code issued for an owner.
 *
 * The schema permits multiple referral codes for one owner, so callers must
 * not join referral_codes directly when they need one row per owner.
 */
type ReferralOwnerIdSql = "?" | "r.id";
type ReferralEventIdSql = "?" | "r.event_id";

export function firstReferralCodeQuerySql(
  ownerType: "registration" | "proposal",
  ownerIdSql: ReferralOwnerIdSql,
  eventIdSql?: ReferralEventIdSql,
): string {
  return `SELECT referral.code
            FROM referral_codes referral
           WHERE referral.owner_type = '${ownerType}'
             AND referral.owner_id = ${ownerIdSql}
             ${eventIdSql ? `AND referral.event_id = ${eventIdSql}` : ""}
           ORDER BY referral.created_at ASC, referral.code ASC
           LIMIT 1`;
}

export function firstReferralCodeForOwnerSql(
  ownerType: "registration" | "proposal",
  ownerIdSql: ReferralOwnerIdSql,
  eventIdSql?: ReferralEventIdSql,
): string {
  return `(${firstReferralCodeQuerySql(ownerType, ownerIdSql, eventIdSql)})`;
}
