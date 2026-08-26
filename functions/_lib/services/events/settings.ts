import { isEventCustomSettingKey, type EventSettingsInput } from "../../../../assets/shared/schemas/event-management";
import type { DatabaseLike, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { parseJsonSafe, stringifyJson } from "../../utils/json";
import { resolveHeroImageSource } from "../../utils/hero-image-url";
import { nowIso } from "../../utils/time";
import { prepareAuditLog, prepareScopedAuditLogAfterOneChange, type AuditScope } from "../audit";
import { getEventBySlug, type EventRecord } from "../events";
import { getAdminEventDetail } from "./admin-detail";

function setFormLink(
  settings: Record<string, unknown>,
  purpose: "event_registration" | "proposal_submission",
  formKey: string | null | undefined,
): void {
  if (formKey === undefined) return;
  const forms = (settings.forms as Record<string, unknown> | undefined) ?? {};
  forms[purpose] = formKey;
  settings.forms = forms;
}

/** Keeps creation routes from inventing divergent venue/virtual-URL codecs. */
export function initialEventSettings(
  input: Pick<EventSettingsInput, "venue" | "virtualUrl" | "location">,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (input.venue) settings["venue"] = input.venue;
  if (input.virtualUrl) settings["virtualUrl"] = input.virtualUrl;
  if (input.location) settings["location"] = input.location;
  return settings;
}

function mergeEventSettings(
  existingJson: string,
  input: Omit<EventSettingsInput, "registrationMode"> & { registrationMode?: string },
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
  assignNullable("virtualUrl", input.virtualUrl);
  assignNullable("location", input.location);
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
  setFormLink(settings, "event_registration", input.registrationFormKey);
  setFormLink(settings, "proposal_submission", input.proposalFormKey);
  return settings;
}

export interface EventSettingsMutationInput {
  event: EventRecord;
  actorId: string;
  settings: Omit<EventSettingsInput, "registrationMode"> & { registrationMode?: string };
  appBaseUrl: string;
  allowedHeroImageHosts?: string;
  expectedUpdatedAt?: string;
  links?: readonly string[];
  auditScope?: AuditScope;
  auditDetails?: unknown;
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
  const at = nowIso();
  const mergedSettings = mergeEventSettings(
    event.settings_json,
    input.settings,
    input.appBaseUrl,
    input.allowedHeroImageHosts,
  );
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE events
            SET name = COALESCE(?, name),
                timezone = COALESCE(?, timezone),
                starts_at = IIF(? = 1, starts_at, ?),
                ends_at = IIF(? = 1, ends_at, ?),
                registration_mode = COALESCE(?, registration_mode),
                links_json = IIF(? = 1, ?, links_json),
                invite_limit_attendee = COALESCE(?, invite_limit_attendee),
                settings_json = ?, updated_at = ?
          WHERE id = ? AND (? IS NULL OR updated_at = ?)`,
      )
      .bind(
        input.settings.name ?? null,
        input.settings.timezone ?? null,
        input.settings.startsAt === undefined ? 1 : 0,
        input.settings.startsAt ?? null,
        input.settings.endsAt === undefined ? 1 : 0,
        input.settings.endsAt ?? null,
        input.settings.registrationMode ?? null,
        input.links === undefined ? 0 : 1,
        input.links === undefined ? null : stringifyJson(input.links),
        input.settings.inviteLimitAttendee ?? null,
        stringifyJson(mergedSettings),
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
        input.auditDetails ?? input.settings,
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
        input.auditDetails ?? input.settings,
        at,
        null,
        input.auditScope,
      ),
    );
  }
  return statements;
}

export async function updateEventSettings(
  db: DatabaseLike,
  input: {
    eventSlug: string;
    actorId: string;
    settings: EventSettingsInput;
    appBaseUrl: string;
    allowedHeroImageHosts?: string;
  },
) {
  const event = await getEventBySlug(db, input.eventSlug);
  await db.batch(
    buildEventSettingsMutationStatements(db, {
      event,
      actorId: input.actorId,
      settings: input.settings,
      appBaseUrl: input.appBaseUrl,
      allowedHeroImageHosts: input.allowedHeroImageHosts,
    }),
  );

  // Return the same normalized projection as the admin detail GET route. This
  // keeps PATCH consumers on one response contract instead of exposing the
  // raw database event row.
  return getAdminEventDetail(db, input.eventSlug);
}
