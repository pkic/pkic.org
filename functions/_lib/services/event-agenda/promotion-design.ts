import {
  defaultEventPromotionDesign,
  eventPromotionDesignSchema,
} from "../../../../assets/shared/schemas/event-promotion-design";
import { eventBadgeTemplateSchema } from "../../../../assets/shared/schemas/event-badge-template";
import type { DatabaseLike, Env } from "../../types";
import { getEventById } from "../events";
import { prepareBadgePrintingBasis, getBadgePrintingContext } from "../event-participation/badge-print-branding";
import { parseJsonSafe } from "../../utils/json";
import { bytesToBase64 } from "../../../../assets/shared/base64";
import { listActiveSponsorshipTierNames } from "../sponsorship/tier-catalog";
/** Event-owned artwork falls back to the event's selected badge assets, never a city-name conditional. */
export async function resolvePromotionDesign(db: DatabaseLike, eventId: string) {
  const event = await getEventById(db, eventId),
    settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  const badge = eventBadgeTemplateSchema
    .nullable()
    .parse(settings.promotionDesign ? null : (settings.badgeTemplate ?? null));
  const design = eventPromotionDesignSchema.parse(
    settings.promotionDesign ?? defaultEventPromotionDesign(event.name, badge),
  );
  if (design.sponsorSource === "event")
    design.sponsorGroups = (await listActiveSponsorshipTierNames(db, "event"))
      .reverse()
      .map((tierName, index) => ({ key: `event_${index}`, source: "event" as const, tierName }));
  const brandingRevision = design.sponsorGroups.length
    ? (await prepareBadgePrintingBasis(db, eventId, design.sponsorGroups)).revision
    : event.updated_at;
  return {
    event,
    design,
    brandingRevision,
    place: [typeof settings.venue === "string" ? settings.venue : null, event.city].filter(Boolean).join(", "),
  };
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
        id: s.id,
        name: s.name,
        base64: bytesToBase64(new TextEncoder().encode(s.svg)),
      })),
    })),
  };
}
