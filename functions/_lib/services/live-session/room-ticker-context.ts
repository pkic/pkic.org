import { slugify } from "../../../../assets/shared/slug";
import { liveTickerContextSchema, type LiveTickerContext } from "../../../../assets/shared/schemas/live-session-ticker";
import { sponsorsListQuerySchema } from "../../../../assets/shared/schemas/public-sponsors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { listPublicSponsorDisplay } from "../public-sponsors";
import { AppError } from "../../errors";
/** Exactly the bounded public sponsor projection; no private contact or contract fields enter a live room. */
export async function readLiveTickerContext(db: DatabaseLike, eventId: string): Promise<LiveTickerContext> {
  const event = await first<{ slug: string; timezone: string }>(db, "SELECT slug,timezone FROM events WHERE id=?", [
    eventId,
  ]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  const display = await listPublicSponsorDisplay(
    db,
    sponsorsListQuerySchema.parse({ eventSlug: event.slug, sort: "-weight", limit: 200, offset: 0 }),
  );
  return liveTickerContextSchema.parse({
    timeZone: event.timezone,
    sponsorGroups: display.groups.slice(0, 20).map((group) => ({
      key: slugify(group.tierName, { maxLength: 80 }),
      tier: group.tierName,
      names: group.sponsors.map((sponsor) => sponsor.name),
    })),
  });
}
