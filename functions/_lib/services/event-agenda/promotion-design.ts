import { eventPlaceSummary } from "../../../../assets/shared/event-place";
import { svgLogoDimensions } from "../../utils/svg-logo";
import { eventPromotionDesignFromSettings } from "../../../../assets/shared/schemas/event-promotion-design";
import type { DatabaseLike, Env } from "../../types";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst, batchRows } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { prepareConfiguredSponsorBranding } from "./sponsors";
import { badgePrintingBasisRevision, getBadgePrintingContext } from "../event-participation/badge-print-branding";
import { parseJsonSafe } from "../../utils/json";
import { bytesToBase64 } from "../../../../assets/shared/base64";

/** Event-owned artwork falls back to the event's selected badge assets, never a city-name conditional. */
export function preparePromotionDesign(db: DatabaseLike, selection: EventReadSelection) {
  const scope = eventReadIdSql(selection),
    eventSponsors = prepareConfiguredSponsorBranding(db, selection),
    consortiumSponsors = prepareConfiguredSponsorBranding(db, selection, true);
  return {
    statements: [
      db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id=${scope.sql}`).bind(...scope.bindings),
      db.prepare(
        "SELECT tier FROM sponsorship_tier_catalog WHERE sponsor_type='event' AND active=1 ORDER BY display_weight DESC,tier DESC",
      ),
      ...eventSponsors.statements,
      ...consortiumSponsors.statements,
    ],
    async decode(loaded: D1StatementResult[]) {
      const event = batchFirst<EventRecord>(loaded[0]);
      if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
      const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
      const design = eventPromotionDesignFromSettings(event.name, settings);
      if (design.sponsorSource === "event")
        design.sponsorGroups = batchRows<{ tier: string }>(loaded[1]).map((row, index) => ({
          key: `event_${index}`,
          source: "event" as const,
          tierName: row.tier,
        }));
      const populations = {
        event: eventSponsors.decode(loaded.slice(2, 3)).rows,
        consortium: consortiumSponsors.decode(loaded.slice(3, 4)).rows,
      };
      const brandingRevision = design.sponsorGroups.length
        ? await badgePrintingBasisRevision(
            event.id,
            event.name,
            event.settings_json,
            populations.event,
            populations.consortium,
          )
        : event.updated_at;
      return {
        event,
        design,
        brandingRevision,
        place: eventPlaceSummary({ ...event, venue: typeof settings.venue === "string" ? settings.venue : null }) ?? "",
      };
    },
  };
}
export async function resolvePromotionDesign(db: DatabaseLike, eventId: string) {
  const read = preparePromotionDesign(db, eventId);
  return read.decode(await db.batch(read.statements));
}

export async function promotionSponsorArtwork(db: DatabaseLike, env: Pick<Env, "ASSETS_BUCKET">, eventId: string) {
  const { design } = await resolvePromotionDesign(db, eventId);
  if (!design.sponsorGroups.length) return { revision: "", sponsors: [] };
  const context = await getBadgePrintingContext(db, env, eventId, design.sponsorGroups);
  return {
    revision: context.revision,
    sponsors: context.branding.map((group) => ({
      tierName: group.tierName,
      ...(group.label ? { label: group.label } : {}),
      sponsors: group.sponsors.map((s) => ({
        aspectRatio: (() => {
          const size = svgLogoDimensions(s.svg);
          return size && size.width > 0 && size.height > 0 ? size.width / size.height : 2.8;
        })(),
        id: s.id,
        name: s.name,
        base64: bytesToBase64(new TextEncoder().encode(s.svg)),
      })),
    })),
  };
}
