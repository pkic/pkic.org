import type { EventTicketsConfiguration } from "../../../../assets/shared/schemas/event-tickets";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { codeOfSponsorSql, eventSponsorsCte } from "./event-sponsors";

interface TierRow {
  tier_name: string;
  sponsor_type: string | null;
  staff_passes: number;
  customer_passes: number;
  sponsors: number;
  sponsors_with_codes: number;
}

/**
 * Every tier the event knows: the consortium's and events' tiers in the catalog, a tier with passes, one in the
 * event's own tier list, or one an active sponsor holds. Consortium tiers come first, highest first.
 */
export async function readSponsorPassTiers(
  db: DatabaseLike,
  eventId: string,
): Promise<EventTicketsConfiguration["sponsorPasses"]["tiers"]> {
  const rows = await all<TierRow>(
    db,
    `WITH ${eventSponsorsCte("?1")},
     tiers AS (
       SELECT tier AS tier_name FROM sponsorship_tier_catalog WHERE active = 1
       UNION SELECT tier_name FROM event_ticket_sponsor_passes WHERE event_id = ?1
       UNION SELECT tier_name FROM event_sponsor_attendee_tiers WHERE event_id = ?1
       UNION SELECT tier FROM event_sponsors
     )
     SELECT tiers.tier_name,
            (SELECT catalog.sponsor_type FROM sponsorship_tier_catalog catalog
             WHERE catalog.tier = tiers.tier_name ORDER BY catalog.sponsor_type LIMIT 1) AS sponsor_type,
            COALESCE(passes.staff_passes, 0) AS staff_passes,
            COALESCE(passes.customer_passes, 0) AS customer_passes,
            (SELECT COUNT(*) FROM event_sponsors sponsor WHERE sponsor.tier = tiers.tier_name) AS sponsors,
            (SELECT COUNT(*) FROM event_sponsors sponsor
             WHERE sponsor.tier = tiers.tier_name
               AND EXISTS (SELECT 1 FROM event_ticket_codes code
                           WHERE code.event_id = ?1 AND code.pass_kind IS NOT NULL
                             AND ${codeOfSponsorSql("code", "sponsor")})) AS sponsors_with_codes,
            (SELECT MAX(catalog.display_weight) FROM sponsorship_tier_catalog catalog
             WHERE catalog.tier = tiers.tier_name) AS weight
     FROM tiers LEFT JOIN event_ticket_sponsor_passes passes
       ON passes.event_id = ?1 AND passes.tier_name = tiers.tier_name
     ORDER BY CASE sponsor_type WHEN 'consortium' THEN 0 WHEN 'event' THEN 1 ELSE 2 END,
              weight DESC, tiers.tier_name LIMIT 40`,
    [eventId],
  );
  return rows.map((row) => ({
    tierName: row.tier_name,
    sponsorType: row.sponsor_type === "consortium" || row.sponsor_type === "event" ? row.sponsor_type : null,
    staffPasses: row.staff_passes,
    customerPasses: row.customer_passes,
    sponsors: row.sponsors,
    sponsorsWithCodes: row.sponsors_with_codes,
  }));
}
