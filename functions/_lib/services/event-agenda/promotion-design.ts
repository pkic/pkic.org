import {
  BADGE_SPONSOR_ARTWORK_LIMITS,
  type BadgeSponsorSource,
} from "../../../../assets/shared/schemas/event-badge-template";
import { eventPlaceSummary } from "../../../../assets/shared/event-place";
import { svgLogoDimensions } from "../../utils/svg-logo";
import {
  eventPromotionDesignFromSettings,
  PROMOTION_SPONSOR_ARTWORK_LIMITS,
} from "../../../../assets/shared/schemas/event-promotion-design";
import type { DatabaseLike, Env } from "../../types";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst, batchRows } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { prepareConfiguredSponsorBranding } from "./sponsors";
import {
  badgeEventInstant,
  badgePrintingBasisRevision,
  loadBadgeSponsorArtwork,
} from "../event-participation/badge-print-branding";
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
        "SELECT sponsor_type,tier FROM sponsorship_tier_catalog WHERE sponsor_type IN('event','consortium') AND active=1 AND display_weight>0 ORDER BY display_weight DESC,sponsor_type DESC,tier DESC",
      ),
      ...eventSponsors.statements,
      ...consortiumSponsors.statements,
    ],
    async decode(loaded: D1StatementResult[]) {
      const event = batchFirst<EventRecord>(loaded[0]);
      if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
      const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
      const design = eventPromotionDesignFromSettings(event.name, settings);
      const limits = design.sponsorSource === "event" ? PROMOTION_SPONSOR_ARTWORK_LIMITS : BADGE_SPONSOR_ARTWORK_LIMITS;
      const populations = {
        event: eventSponsors.decode(loaded.slice(2, 3), limits.maxCount).rows,
        consortium: consortiumSponsors.decode(loaded.slice(3, 4), limits.maxCount).rows,
      };
      if (
        design.sponsorSource === "event" &&
        populations.event.length + populations.consortium.length > limits.maxCount
      )
        throw new AppError(422, "BADGE_SPONSOR_LIMIT", `Use at most ${limits.maxCount} sponsors in these materials.`);
      if (design.sponsorSource === "event") {
        design.sponsorGroups = batchRows<{ sponsor_type: BadgeSponsorSource; tier: string }>(loaded[1])
          .filter((row) =>
            populations[row.sponsor_type].some(
              (sponsor) => (row.sponsor_type === "event" ? sponsor.event_tier : sponsor.tier) === row.tier,
            ),
          )
          .map((row, index) => ({
            key: `sponsor_${index}`,
            source: row.sponsor_type,
            tierName: row.tier,
            ...(row.sponsor_type === "consortium" ? { label: `PKI Consortium · ${row.tier}` } : {}),
          }));
      }
      const brandingRevision = design.sponsorGroups.length
        ? await badgePrintingBasisRevision(
            event.id,
            event.name,
            event.settings_json,
            populations.event,
            populations.consortium,
            {
              startsAt: badgeEventInstant(event.starts_at),
              endsAt: badgeEventInstant(event.ends_at),
              timezone: event.timezone,
              city: event.city,
            },
          )
        : event.updated_at;
      return {
        event,
        design,
        brandingRevision,
        populations,
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
  return promotionDesignArtwork(env, await resolvePromotionDesign(db, eventId));
}

export async function promotionDesignArtwork(
  env: Pick<Env, "ASSETS_BUCKET">,
  visual: Awaited<ReturnType<typeof resolvePromotionDesign>>,
) {
  const { design, populations } = visual;
  if (!design.sponsorGroups.length) return { revision: "", sponsors: [] };
  const context = await loadBadgeSponsorArtwork(
    env,
    populations,
    design.sponsorGroups,
    design.sponsorSource === "event" ? PROMOTION_SPONSOR_ARTWORK_LIMITS : undefined,
  );
  return {
    revision: visual.brandingRevision,
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
