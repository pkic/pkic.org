import type { EventTicketsConfiguration } from "../../../../assets/shared/schemas/event-tickets";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

interface TierRow {
  tier_name: string;
  staff_passes: number;
  customer_passes: number;
  sponsors: number;
  sponsors_with_codes: number;
}

/** Every tier the event knows: with an allocation, with an active sponsor, or in its sponsor tier list. */
export async function readSponsorPassTiers(
  db: DatabaseLike,
  eventId: string,
): Promise<EventTicketsConfiguration["sponsorPasses"]["tiers"]> {
  const rows = await all<TierRow>(
    db,
    `WITH tiers AS (
       SELECT tier_name FROM event_ticket_sponsor_passes WHERE event_id = ?1
       UNION SELECT tier_name FROM event_sponsor_attendee_tiers WHERE event_id = ?1
       UNION SELECT tier FROM sponsorships WHERE event_id = ?1 AND pipeline_stage = 'active' AND tier IS NOT NULL
     )
     SELECT tiers.tier_name,
            COALESCE(passes.staff_passes, 0) AS staff_passes,
            COALESCE(passes.customer_passes, 0) AS customer_passes,
            (SELECT COUNT(*) FROM sponsorships sponsor
             WHERE sponsor.event_id = ?1 AND sponsor.pipeline_stage = 'active' AND sponsor.tier = tiers.tier_name) AS sponsors,
            (SELECT COUNT(*) FROM sponsorships sponsor
             WHERE sponsor.event_id = ?1 AND sponsor.pipeline_stage = 'active' AND sponsor.tier = tiers.tier_name
               AND EXISTS (SELECT 1 FROM event_ticket_codes code WHERE code.sponsorship_id = sponsor.id)) AS sponsors_with_codes
     FROM tiers LEFT JOIN event_ticket_sponsor_passes passes
       ON passes.event_id = ?1 AND passes.tier_name = tiers.tier_name
     ORDER BY tiers.tier_name LIMIT 40`,
    [eventId],
  );
  return rows.map((row) => ({
    tierName: row.tier_name,
    staffPasses: row.staff_passes,
    customerPasses: row.customer_passes,
    sponsors: row.sponsors,
    sponsorsWithCodes: row.sponsors_with_codes,
  }));
}
