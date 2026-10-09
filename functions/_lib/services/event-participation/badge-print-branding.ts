import { ZodError } from "zod";
import {
  eventBadgeTemplateSchema,
  badgeTemplateBrandingSchema,
  BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES,
  BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_BYTES,
  BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT,
  BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT,
  badgeTemplateSponsorGroupSchema,
  badgeSponsorGroupSource,
  type BadgeSponsorSource,
  type BadgeTemplateSponsorGroup,
} from "../../../../assets/shared/schemas/event-badge-template";
import { createGenericBadgeTemplate } from "../../../../assets/shared/badge-generic-template";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { sha256Hex } from "../../utils/crypto";
import { readBoundedStream } from "../../utils/bounded-stream";
import { sanitizeSvgLogo } from "../../utils/svg-logo";
import {
  prepareAgendaSponsorTierRead,
  prepareAgendaSponsorBrandingRead,
  prepareConsortiumSponsorTierRead,
} from "../event-agenda/sponsors";

type BrandingRow = Awaited<ReturnType<typeof prepareAgendaSponsorTierRead>>["rows"][number];
/** The tier a row holds within one source's population. */
function sourceTier(row: BrandingRow, source: BadgeSponsorSource): string | null {
  return source === "consortium" ? row.tier : row.event_tier;
}

/** Cheap database basis is rechecked for each badge; artwork is loaded once per document. */
export async function prepareBadgePrintingBasis(db: DatabaseLike, eventId: string) {
  const event = await first<{ name: string; settings_json: string }>(
    db,
    "SELECT name,settings_json FROM events WHERE id=?",
    [eventId],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  const rawSettings = parseJsonSafe<unknown>(event.settings_json, {});
  const settings =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : {};
  const parsed = eventBadgeTemplateSchema.nullable().safeParse(settings.badgeTemplate ?? null);
  if (!parsed.success)
    throw new AppError(
      422,
      "BADGE_TEMPLATE_INVALID",
      "The event badge template is invalid. Update it before printing.",
    );
  const override = parsed.data;
  const tiersOf = (source: BadgeSponsorSource) =>
    (override?.sponsorGroups ?? []).filter((group) => badgeSponsorGroupSource(group) === source).map((g) => g.tierName);
  const eventPopulation = override
    ? await prepareAgendaSponsorTierRead(db, eventId, tiersOf("event"))
    : await prepareAgendaSponsorBrandingRead(db, eventId);
  const consortiumTiers = tiersOf("consortium");
  const consortiumPopulation = consortiumTiers.length
    ? await prepareConsortiumSponsorTierRead(db, eventId, consortiumTiers)
    : null;
  const populations = {
    event: eventPopulation.rows,
    consortium: consortiumPopulation?.rows ?? [],
  } satisfies Record<BadgeSponsorSource, readonly BrandingRow[]>;
  if (populations.event.length + populations.consortium.length > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT)
    throw new AppError(422, "BADGE_SPONSOR_LIMIT", "Use at most 40 sponsors in one badge template.");
  let template = override;
  if (!template) {
    const tiers = [
      ...new Set(
        [...eventPopulation.rows]
          .sort(
            (left, right) =>
              right.effective_weight - left.effective_weight ||
              (left.event_tier ?? "").localeCompare(right.event_tier ?? ""),
          )
          .map((row) => row.event_tier!),
      ),
    ];
    if (tiers.length > BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT)
      throw new AppError(
        422,
        "BADGE_SPONSOR_GROUP_LIMIT",
        "Use at most eight visible event sponsor tiers in one badge document.",
      );
    const sponsorGroups = await Promise.all(
      tiers.map(async (tierName) =>
        badgeTemplateSponsorGroupSchema.parse({
          key: `tier-${(await sha256Hex(tierName)).slice(0, 16)}`,
          source: "event",
          tierName,
        }),
      ),
    );
    try {
      template = createGenericBadgeTemplate({ eventName: event.name, sponsorGroups });
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      throw new AppError(
        422,
        "BADGE_TEMPLATE_INVALID",
        "The event name cannot fit the generic badge template. Update the event name or configure a badge template before printing.",
      );
    }
  }
  const revision = await sha256Hex(
    JSON.stringify({
      eventId,
      eventName: event.name,
      settings: event.settings_json,
      sponsors: populations.event.map((row) => JSON.parse(row.source_json)),
      consortiumSponsors: populations.consortium.map((row) => JSON.parse(row.source_json)),
    }),
  );
  return {
    revision,
    template,
    populations,
    guards: [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND name=? AND settings_json=?",
        bindings: [eventId, event.name, event.settings_json],
      }),
      eventPopulation.guard,
      ...(consortiumPopulation ? [consortiumPopulation.guard] : []),
    ],
  };
}

/** `reason` carries the sanitizer's refusal (for example live text) so the organizer knows what to fix. */
function replacement(name: string, reason?: string): AppError {
  const instruction = `Replace the logo for ${name} with a valid vector SVG before printing this sponsor group.`;
  return new AppError(422, "BADGE_SPONSOR_SVG_REQUIRED", reason ? `${instruction} ${reason}` : instruction);
}

/** No URL is fetched: only pointers from the canonical active event sponsor read model are followed. */
export async function getBadgePrintingContext(
  db: DatabaseLike,
  environment: Pick<Env, "ASSETS_BUCKET">,
  eventId: string,
) {
  const basis = await prepareBadgePrintingBasis(db, eventId);
  const logos = new Map<string, { id: string; name: string; svg: string }>();
  const capturedObjects: { key: string; etag: string }[] = [];
  let totalBytes = 0;
  for (const row of [...basis.populations.consortium, ...basis.populations.event]) {
    if (logos.has(row.id)) continue;
    const key = row.logo_r2_key ?? row.sponsorship_logo_r2_key;
    if (!key || !/^(?:org-logos|sponsor-logos)\//.test(key) || key.split("/").includes(".."))
      throw replacement(row.name);
    const bucket = environment.ASSETS_BUCKET;
    if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured.");
    const object = await bucket.get(key);
    if (!object) throw replacement(row.name);
    if (object.size > BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES)
      throw new AppError(
        413,
        "BADGE_SPONSOR_LOGO_TOO_LARGE",
        `The logo for ${row.name} exceeds the 1 MiB badge artwork limit.`,
      );
    const read = await readBoundedStream(object.body, BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES);
    if (!read.ok)
      throw new AppError(
        413,
        "BADGE_SPONSOR_LOGO_TOO_LARGE",
        `The logo for ${row.name} exceeds the 1 MiB badge artwork limit.`,
      );
    let svg: string;
    try {
      const cleaned = await sanitizeSvgLogo(read.bytes.buffer as ArrayBuffer);
      if (cleaned.buffer.byteLength > BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES)
        throw new AppError(
          413,
          "BADGE_SPONSOR_LOGO_TOO_LARGE",
          `The normalized logo for ${row.name} exceeds the 1 MiB badge artwork limit.`,
        );
      totalBytes += cleaned.buffer.byteLength;
      svg = new TextDecoder("utf-8", { fatal: true }).decode(cleaned.buffer);
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_SVG_LOGO") throw replacement(row.name, error.message);
      throw error;
    }
    if (totalBytes > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_BYTES)
      throw new AppError(
        413,
        "BADGE_SPONSOR_ARTWORK_TOO_LARGE",
        "The selected sponsor logos exceed the 4 MiB document artwork limit.",
      );
    logos.set(row.id, { id: row.id, name: row.name, svg });
    capturedObjects.push({ key, etag: object.etag });
  }
  const branding: BadgeTemplateSponsorGroup[] = (basis.template?.sponsorGroups ?? []).flatMap((group) => {
    const source = badgeSponsorGroupSource(group);
    const sponsors = [
      ...new Map(
        basis.populations[source]
          .filter((row) => sourceTier(row, source) === group.tierName)
          .map((row) => [row.id, logos.get(row.id)!]),
      ).values(),
    ];
    return sponsors.length ? [{ ...group, sponsors }] : [];
  });
  const checkedBranding = badgeTemplateBrandingSchema.safeParse(branding);
  if (!checkedBranding.success)
    throw new AppError(
      422,
      "BADGE_SPONSOR_ARTWORK_INVALID",
      "The selected sponsor artwork cannot be safely printed. Replace it with a valid vector SVG.",
    );
  for (const captured of capturedObjects) {
    const current = await environment.ASSETS_BUCKET!.head(captured.key);
    if (!current || current.etag !== captured.etag)
      throw new AppError(409, "BADGE_SPONSOR_CHANGED", "Sponsor artwork changed. Reload the print document.");
  }
  await db.batch(basis.guards);
  return { revision: basis.revision, template: basis.template, branding: checkedBranding.data };
}
