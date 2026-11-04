import { eventHeroImageKey } from "../../utils/event-hero-image";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { SITE_PUBLICATION_SITE_RESOURCE_ID } from "../../../../assets/shared/schemas/site-publication-requests";
import { prepareEventSpeakingStanding } from "../member-standing/event-speaking";
import { isEventCustomSettingKey, type EventSettingsInput } from "../../../../assets/shared/schemas/event-management";
import { BADGE_TEMPLATE_SETTINGS_MAX_BYTES } from "../../../../assets/shared/schemas/event-badge-template";
import type { DatabaseLike, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { parseJsonSafe, stringifyJson } from "../../utils/json";
import { resolveHeroImageSource } from "../../utils/hero-image-url";
import { nowIso } from "../../utils/time";
import { prepareAuditLog, prepareScopedAuditLogAfterOneChange, type AuditScope } from "../audit";
import type { EventRecord } from "../events";

function mergeEventSettings(
  existingJson: string,
  input: Omit<EventSettingsInput, "registrationPolicy"> & { registrationPolicy?: string },
  appBaseUrl: string,
  allowedHeroImageHosts?: string,
): Record<string, unknown> {
  const existing = parseJsonSafe<Record<string, unknown>>(existingJson, {});
  const custom = Object.fromEntries(
    Object.entries(input.settings ?? {}).filter(([key]) => isEventCustomSettingKey(key)),
  );
  const settings = { ...existing, ...custom };
  const assignNullable = (key: string, value: unknown): void => {
    if (value === undefined) return;
    if (value === null) delete settings[key];
    else settings[key] = value;
  };
  assignNullable("venue", input.venue);
  assignNullable("badgeTemplate", input.badgeTemplate);
  assignNullable("promotionDesign", input.promotionDesign);
  assignNullable("virtualUrl", input.virtualUrl);
  assignNullable("attendance", input.attendance);
  if (input.heroImageUrl !== undefined) {
    const heroImage =
      input.heroImageUrl === null
        ? null
        : resolveHeroImageSource(input.heroImageUrl, appBaseUrl, allowedHeroImageHosts);
    if (input.heroImageUrl !== null && !heroImage) {
      throw new AppError(
        400,
        "HERO_IMAGE_HOST_NOT_ALLOWED",
        "Hero images must use a same-origin path or an approved HTTPS host.",
      );
    }
    assignNullable("heroImageUrl", heroImage?.assetPath ?? heroImage?.url ?? null);
  }
  if (input.sessionTypes !== undefined) {
    const proposal = { ...((settings.proposal as Record<string, unknown> | undefined) ?? {}) };
    if (!input.sessionTypes?.length) delete proposal.sessionTypes;
    else proposal.sessionTypes = input.sessionTypes;
    if (Object.keys(proposal).length === 0) delete settings.proposal;
    else settings.proposal = proposal;
  }
  delete settings.forms;
  return settings;
}

export interface EventSettingsMutationInput {
  event: EventRecord;
  actorId: string;
  settings: Omit<EventSettingsInput, "registrationPolicy"> & { registrationPolicy?: string };
  appBaseUrl: string;
  allowedHeroImageHosts?: string;
  expectedUpdatedAt?: string;
  links?: readonly string[];
  auditScope?: AuditScope;
  auditDetails?: unknown;
  authorizationGuards?: StatementLike[];
  /** A caller-owned monotonic configuration instant when writes share the same clock tick. */
  updatedAt?: string;
}

/**
 * Builds the complete local event-settings transition. The caller owns the
 * batch boundary so group resource management can prepend its live authority
 * guard to this same transaction.
 */
export function buildEventSettingsMutationStatements(
  db: DatabaseLike,
  input: EventSettingsMutationInput,
): StatementLike[] {
  const { event } = input;
  if (input.settings.slug !== undefined && input.settings.slug !== event.slug && !input.settings.confirmSlugChange) {
    throw new AppError(
      409,
      "EVENT_SLUG_CHANGE_CONFIRMATION_REQUIRED",
      "Changing the event slug breaks existing slug-based links. Confirm this change before saving.",
    );
  }
  if (
    input.settings.slug !== undefined &&
    input.settings.slug !== event.slug &&
    event.source_mode === "hugo" &&
    !event.base_path
  ) {
    throw new AppError(
      409,
      "EVENT_SOURCE_IDENTITY_REQUIRED",
      "Import this event with its stable website path before changing its slug.",
    );
  }
  const at = input.updatedAt ?? nowIso();
  const mergedSettings = mergeEventSettings(
    event.settings_json,
    input.settings,
    input.appBaseUrl,
    input.allowedHeroImageHosts,
  );
  const previousHero = parseJsonSafe<Record<string, unknown>>(event.settings_json, {}).heroImageUrl;
  // Keep platform-owned image links attached when the event address changes.
  if (input.settings.slug && eventHeroImageKey(event.id, event.slug, mergedSettings.heroImageUrl)) {
    mergedSettings.heroImageUrl = String(mergedSettings.heroImageUrl).replace(
      /^\/api\/v1\/events\/[^/]+\/images\//,
      `/api/v1/events/${encodeURIComponent(input.settings.slug)}/images/`,
    );
  }
  const previousHeroKey = eventHeroImageKey(event.id, event.slug, previousHero);
  const nextHeroKey = eventHeroImageKey(event.id, input.settings.slug ?? event.slug, mergedSettings.heroImageUrl);
  const heroCleanup =
    previousHeroKey && previousHeroKey !== nextHeroKey
      ? prepareStorageDeletion(db, previousHeroKey, at, "assets")
      : null;
  const settingsJson = stringifyJson(mergedSettings);
  if (
    (input.settings.badgeTemplate !== undefined ||
      mergedSettings.badgeTemplate !== undefined ||
      input.settings.promotionDesign !== undefined ||
      mergedSettings.promotionDesign !== undefined) &&
    new TextEncoder().encode(settingsJson).byteLength > BADGE_TEMPLATE_SETTINGS_MAX_BYTES
  ) {
    throw new AppError(
      422,
      "BADGE_TEMPLATE_SETTINGS_TOO_LARGE",
      "The complete event settings with this template must fit within 1 MiB.",
    );
  }
  const auditSource = input.auditDetails ?? input.settings;
  const templateAuditDetails =
    input.settings.badgeTemplate === undefined
      ? auditSource
      : {
          ...(auditSource && typeof auditSource === "object" && !Array.isArray(auditSource)
            ? auditSource
            : { details: auditSource }),
          badgeTemplate:
            input.settings.badgeTemplate === null
              ? null
              : {
                  version: input.settings.badgeTemplate.version,
                  name: input.settings.badgeTemplate.name,
                  assetCount: Object.keys(input.settings.badgeTemplate.assets).length,
                  bytes: new TextEncoder().encode(stringifyJson(input.settings.badgeTemplate)).byteLength,
                },
        };
  const auditDetails =
    input.settings.promotionDesign === undefined
      ? templateAuditDetails
      : {
          ...(templateAuditDetails && typeof templateAuditDetails === "object" && !Array.isArray(templateAuditDetails)
            ? templateAuditDetails
            : { details: templateAuditDetails }),
          promotionDesign: input.settings.promotionDesign
            ? {
                version: input.settings.promotionDesign.version,
                name: input.settings.promotionDesign.name,
                bytes: new TextEncoder().encode(stringifyJson(input.settings.promotionDesign)).byteLength,
              }
            : null,
        };
  const statements: StatementLike[] = [
    ...(input.authorizationGuards ?? []),
    db
      .prepare(
        `UPDATE events
            SET slug = COALESCE(?, slug),
                name = COALESCE(?, name),
                timezone = COALESCE(?, timezone),
                starts_at = IIF(? = 1, starts_at, ?),
                ends_at = IIF(? = 1, ends_at, ?),
                registration_mode = COALESCE(?, registration_mode),
                visibility = COALESCE(?, visibility),
                links_json = IIF(? = 1, ?, links_json),
                city = IIF(? = 1, city, ?),
                country = IIF(? = 1, country, ?),
                invite_limit_attendee = COALESCE(?, invite_limit_attendee),
                settings_json = ?, updated_at = ?
          WHERE id = ? AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = strftime('%Y-%m-%dT%H:%M:%fZ', ?))`,
      )
      .bind(
        input.settings.slug ?? null,
        input.settings.name ?? null,
        input.settings.timezone ?? null,
        input.settings.startsAt === undefined ? 1 : 0,
        input.settings.startsAt ?? null,
        input.settings.endsAt === undefined ? 1 : 0,
        input.settings.endsAt ?? null,
        input.settings.registrationPolicy ?? null,
        input.settings.visibility ?? null,
        input.links === undefined ? 0 : 1,
        input.links === undefined ? null : stringifyJson(input.links),
        input.settings.city === undefined ? 1 : 0,
        input.settings.city ?? null,
        input.settings.country === undefined ? 1 : 0,
        input.settings.country ?? null,
        input.settings.inviteLimitAttendee ?? null,
        settingsJson,
        at,
        event.id,
        input.expectedUpdatedAt ?? null,
        input.expectedUpdatedAt ?? null,
      ),
  ];
  if (input.expectedUpdatedAt) {
    statements.push(
      prepareScopedAuditLogAfterOneChange(
        db,
        input.auditScope ?? { type: "event", id: event.id },
        "admin",
        input.actorId,
        "event_settings_updated",
        "event",
        event.id,
        auditDetails,
        at,
      ),
    );
  }
  if (input.settings.userRetentionDays !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO retention_policies (event_id, user_retention_days, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET
             user_retention_days = excluded.user_retention_days,
             updated_at = excluded.updated_at`,
        )
        .bind(event.id, input.settings.userRetentionDays, at),
    );
  }
  if (!input.expectedUpdatedAt) {
    statements.push(
      prepareAuditLog(
        db,
        "admin",
        input.actorId,
        "event_settings_updated",
        "event",
        event.id,
        auditDetails,
        at,
        null,
        input.auditScope,
      ),
    );
  }
  if (input.settings.startsAt !== undefined || input.settings.endsAt !== undefined) {
    statements.push(
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "site_content",
          resourceId: SITE_PUBLICATION_SITE_RESOURCE_ID,
          revision: Date.parse(at),
          reasonCode: "sponsorship_changed",
          deduplicationKey: `event-sponsor-dates:${event.id}:${crypto.randomUUID()}`,
        },
        {
          sql: "EXISTS(SELECT 1 FROM sponsorships WHERE sponsor_type='consortium' OR event_id=?)",
          bindings: [event.id],
        },
      ),
    );
  }
  if (input.settings.endsAt !== undefined) {
    statements.push(...prepareEventSpeakingStanding(db, at, { eventId: event.id }));
  }
  if (heroCleanup) statements.push(heroCleanup);
  return statements;
}
