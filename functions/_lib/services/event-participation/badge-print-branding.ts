import { z } from "zod";
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
import {
  GENERIC_BADGE_LAYOUT_VERSION,
  type GenericBadgeTemplateInput,
} from "../../../../assets/shared/badge-generic-template-policy";
import { persistedUtcInstant } from "../../utils/time";
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

/** Normalize legacy offset instants; retain malformed values for default-template validation. */
export function badgeEventInstant(value: string | null): string | null {
  try {
    return persistedUtcInstant(value);
  } catch {
    const offset = z.iso.datetime({ offset: true }).safeParse(value);
    return offset.success ? new Date(offset.data).toISOString() : value;
  }
}

/** Both automatic layouts and caller-selected sponsor groups share actionable validation errors. */
async function genericTemplateForPrinting(input: GenericBadgeTemplateInput) {
  try {
    const { createGenericBadgeTemplate } = await import("../../../../assets/shared/badge-generic-template");
    return createGenericBadgeTemplate(input);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const fields: Record<string, string> = {
      eventName: "event name",
      title: "event name",
      frontHtml: "event name",
      backHtml: "event name",
      city: "event city",
      timezone: "event time zone",
      startsAt: "event start date",
      endsAt: "event end date",
    };
    const field = fields[String(error.issues[0]?.path[0])] ?? "event badge details";
    throw new AppError(
      422,
      "BADGE_TEMPLATE_INVALID",
      `The ${field} is invalid for the default badge design. Update it in event settings or configure a badge template before printing.`,
    );
  }
}

/** Cheap database basis is rechecked for each badge; artwork is loaded once per document. */
export async function prepareBadgePrintingBasis(
  db: DatabaseLike,
  eventId: string,
  sponsorGroups?: z.infer<typeof badgeTemplateSponsorGroupSchema>[],
) {
  const event = await first<{
    name: string;
    settings_json: string;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string;
    city: string | null;
  }>(db, "SELECT name,settings_json,starts_at,ends_at,timezone,city FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  const display = {
    startsAt: badgeEventInstant(event.starts_at),
    endsAt: badgeEventInstant(event.ends_at),
    timezone: event.timezone,
    city: event.city,
  };
  const rawSettings = parseJsonSafe<unknown>(event.settings_json, {});
  const settings =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : {};
  const parsed = eventBadgeTemplateSchema.nullable().safeParse(sponsorGroups ? null : (settings.badgeTemplate ?? null));
  if (!parsed.success)
    throw new AppError(
      422,
      "BADGE_TEMPLATE_INVALID",
      "The event badge template is invalid. Update it before printing.",
    );
  const override = sponsorGroups
    ? {
        ...(parsed.data ??
          (await genericTemplateForPrinting({ ...display, eventName: event.name, sponsorGroups: [] }))),
        sponsorGroups: sponsorGroups.map((group) => badgeTemplateSponsorGroupSchema.parse(group)),
      }
    : parsed.data;
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
    template = await genericTemplateForPrinting({ ...display, eventName: event.name, sponsorGroups });
  }
  const revision = await badgePrintingBasisRevision(
    eventId,
    event.name,
    event.settings_json,
    populations.event,
    populations.consortium,
    display,
  );
  return {
    revision,
    template,
    populations,
    guards: [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND name=? AND settings_json=? AND starts_at IS ? AND ends_at IS ? AND timezone=? AND city IS ?",
        bindings: [
          eventId,
          event.name,
          event.settings_json,
          event.starts_at,
          event.ends_at,
          event.timezone,
          event.city,
        ],
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

/**
 * Expected sponsor artwork omissions. Unexpected logo read failures are also
 * omitted from tickets, with a diagnostic warning; organizer printing refuses both.
 */
const OMITTABLE_ARTWORK_CODES = new Set([
  "BADGE_SPONSOR_SVG_REQUIRED",
  "BADGE_SPONSOR_LOGO_TOO_LARGE",
  "BADGE_SPONSOR_ARTWORK_TOO_LARGE",
  "UPLOADS_NOT_CONFIGURED",
]);

/**
 * What to do with a sponsor whose artwork cannot be printed. Organizer printing
 * refuses, naming the sponsor and the fix. An attendee's own ticket leaves the
 * sponsor out: their QR code and badge code never wait on sponsor artwork.
 */
export type UnusableSponsorArtwork = "refuse" | "omit";

async function loadSponsorLogo(
  environment: Pick<Env, "ASSETS_BUCKET">,
  row: BrandingRow,
): Promise<{ svg: string; bytes: number; captured: { key: string; etag: string } }> {
  const key = row.logo_r2_key ?? row.sponsorship_logo_r2_key;
  if (!key || !/^(?:org-logos|sponsor-logos)\//.test(key) || key.split("/").includes("..")) throw replacement(row.name);
  const bucket = environment.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured.");
  const object = await bucket.get(key);
  if (!object) throw replacement(row.name);
  const tooLarge = () =>
    new AppError(
      413,
      "BADGE_SPONSOR_LOGO_TOO_LARGE",
      `The logo for ${row.name} exceeds the 1 MiB badge artwork limit.`,
    );
  if (object.size > BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES) throw tooLarge();
  const read = await readBoundedStream(object.body, BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES);
  if (!read.ok) throw tooLarge();
  try {
    const cleaned = await sanitizeSvgLogo(read.bytes.buffer as ArrayBuffer);
    if (cleaned.buffer.byteLength > BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES)
      throw new AppError(
        413,
        "BADGE_SPONSOR_LOGO_TOO_LARGE",
        `The normalized logo for ${row.name} exceeds the 1 MiB badge artwork limit.`,
      );
    return {
      svg: new TextDecoder("utf-8", { fatal: true }).decode(cleaned.buffer),
      bytes: cleaned.buffer.byteLength,
      captured: { key, etag: object.etag },
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_SVG_LOGO") throw replacement(row.name, error.message);
    throw error;
  }
}

/** No URL is fetched: only pointers from the canonical active event sponsor read model are followed. */
export async function getBadgePrintingContext(
  db: DatabaseLike,
  environment: Pick<Env, "ASSETS_BUCKET">,
  eventId: string,
  sponsorGroups?: z.infer<typeof badgeTemplateSponsorGroupSchema>[],
  { unusableArtwork = "refuse" }: { unusableArtwork?: UnusableSponsorArtwork } = {},
) {
  const basis = await prepareBadgePrintingBasis(db, eventId, sponsorGroups);
  const { branding } = await loadBadgeSponsorArtwork(
    environment,
    basis.populations,
    basis.template?.sponsorGroups ?? [],
    { unusableArtwork, eventId },
  );
  await db.batch(basis.guards);
  return { revision: basis.revision, template: basis.template, branding };
}

/** Load and validate artwork from an already authorized, canonical sponsor population. */
export async function loadBadgeSponsorArtwork(
  environment: Pick<Env, "ASSETS_BUCKET">,
  populations: Awaited<ReturnType<typeof prepareBadgePrintingBasis>>["populations"],
  sponsorGroups: z.infer<typeof badgeTemplateSponsorGroupSchema>[],
  { unusableArtwork = "refuse", eventId }: { unusableArtwork?: UnusableSponsorArtwork; eventId?: string } = {},
) {
  if (populations.event.length + populations.consortium.length > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT)
    throw new AppError(422, "BADGE_SPONSOR_LIMIT", "Use at most 40 sponsors in one badge template.");
  const logos = new Map<string, { id: string; name: string; svg: string }>();
  const capturedObjects: { key: string; etag: string }[] = [];
  const omitted: string[] = [];
  let totalBytes = 0;
  for (const row of [...populations.consortium, ...populations.event]) {
    if (logos.has(row.id) || omitted.includes(row.id)) continue;
    try {
      const logo = await loadSponsorLogo(environment, row);
      if (totalBytes + logo.bytes > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_BYTES)
        throw new AppError(
          413,
          "BADGE_SPONSOR_ARTWORK_TOO_LARGE",
          "The selected sponsor logos exceed the 4 MiB document artwork limit.",
        );
      totalBytes += logo.bytes;
      logos.set(row.id, { id: row.id, name: row.name, svg: logo.svg });
      capturedObjects.push(logo.captured);
    } catch (error) {
      if (unusableArtwork === "refuse") throw error;
      // An attendee's ticket never waits on sponsor artwork: unusable or unreadable, the logo is left off.
      if (!(error instanceof AppError) || !OMITTABLE_ARTWORK_CODES.has(error.code))
        console.warn("[badge-ticket] sponsor artwork unreadable", {
          eventId,
          error: error instanceof Error ? error.name : "unknown",
        });
      omitted.push(row.id);
    }
  }
  // Staff see the reason in badge printing; the log says how many sponsors were omitted.
  if (omitted.length)
    console.warn("[badge-ticket] sponsor artwork omitted", {
      eventId,
      sponsors: omitted.length,
    });
  const branding: BadgeTemplateSponsorGroup[] = sponsorGroups.flatMap((group) => {
    const source = badgeSponsorGroupSource(group);
    const sponsors = [
      ...new Map(
        populations[source]
          .filter((row) => sourceTier(row, source) === group.tierName && logos.has(row.id))
          .map((row) => [row.id, logos.get(row.id)!]),
      ).values(),
    ];
    return sponsors.length ? [{ ...group, sponsors }] : [];
  });
  const checkedBranding = badgeTemplateBrandingSchema.safeParse(branding);
  if (!checkedBranding.success) {
    if (unusableArtwork === "refuse")
      throw new AppError(
        422,
        "BADGE_SPONSOR_ARTWORK_INVALID",
        "The selected sponsor artwork cannot be safely printed. Replace it with a valid vector SVG.",
      );
    console.warn("[badge-ticket] sponsor strip omitted", { eventId });
  }
  // A print document must match what staff reviewed; a ticket already holds the artwork it read.
  if (unusableArtwork === "refuse")
    for (const captured of capturedObjects) {
      const current = await environment.ASSETS_BUCKET!.head(captured.key);
      if (!current || current.etag !== captured.etag)
        throw new AppError(409, "BADGE_SPONSOR_CHANGED", "Sponsor artwork changed. Reload the print document.");
    }
  return { branding: checkedBranding.data ?? [], capturedObjects };
}

/** Refusals that name a sponsor's stored artwork: organizers fix these, attendees cannot. */
const SPONSOR_ARTWORK_REFUSALS = new Set([
  "BADGE_SPONSOR_SVG_REQUIRED",
  "BADGE_SPONSOR_LOGO_TOO_LARGE",
  "BADGE_SPONSOR_ARTWORK_TOO_LARGE",
  "BADGE_SPONSOR_ARTWORK_INVALID",
]);

/**
 * The holder's ticket design. Sponsor artwork an organizer still has to replace must not hide the attendee's QR or
 * show them organizer instructions, so the ticket leaves that sponsor out and keeps the usable ones; if the strip
 * still cannot be assembled, it falls back to the same template without sponsor logos. The organizer print document
 * keeps refusing through {@link getBadgePrintingContext}.
 */
export async function getBadgeHolderPrintingContext(
  db: DatabaseLike,
  environment: Pick<Env, "ASSETS_BUCKET">,
  eventId: string,
) {
  try {
    return await getBadgePrintingContext(db, environment, eventId, undefined, {
      unusableArtwork: "omit",
    });
  } catch (error) {
    if (!(error instanceof AppError) || !SPONSOR_ARTWORK_REFUSALS.has(error.code)) throw error;
    const basis = await prepareBadgePrintingBasis(db, eventId);
    await db.batch(basis.guards);
    return { revision: basis.revision, template: basis.template, branding: [] };
  }
}

/** One canonical fingerprint for badge and promotion sponsor populations. */
export function badgePrintingBasisRevision(
  eventId: string,
  eventName: string,
  settings: string,
  sponsors: readonly BrandingRow[],
  consortiumSponsors: readonly BrandingRow[],
  display?: { startsAt: string | null; endsAt: string | null; timezone: string; city: string | null },
) {
  return sha256Hex(
    JSON.stringify({
      eventId,
      defaultLayout: GENERIC_BADGE_LAYOUT_VERSION,
      display,
      eventName,
      settings,
      sponsors: sponsors.map((row) => JSON.parse(row.source_json)),
      consortiumSponsors: consortiumSponsors.map((row) => JSON.parse(row.source_json)),
    }),
  );
}
