import {
  isAdminEventCustomSettingKey,
  type AdminEventSettingsInput,
} from "../../../../assets/shared/schemas/admin-events";
import { normalizeHttpOrSameOriginUrl } from "../../../../assets/shared/schemas/urls";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { parseJsonSafe, stringifyJson } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { getEventBySlug } from "../events";

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

function mergeEventSettings(
  existingJson: string,
  input: AdminEventSettingsInput,
  appBaseUrl: string,
): Record<string, unknown> {
  const existing = parseJsonSafe<Record<string, unknown>>(existingJson, {});
  const custom = Object.fromEntries(
    Object.entries(input.settings ?? {}).filter(([key]) => isAdminEventCustomSettingKey(key)),
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
    assignNullable(
      "heroImageUrl",
      input.heroImageUrl === null ? null : normalizeHttpOrSameOriginUrl(input.heroImageUrl, appBaseUrl),
    );
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

export async function updateEventSettings(
  db: DatabaseLike,
  input: {
    eventSlug: string;
    actorId: string;
    settings: AdminEventSettingsInput;
    appBaseUrl: string;
  },
) {
  const event = await getEventBySlug(db, input.eventSlug);
  const at = nowIso();
  const mergedSettings = mergeEventSettings(event.settings_json, input.settings, input.appBaseUrl);
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE events
            SET name = COALESCE(?, name),
                timezone = COALESCE(?, timezone),
                starts_at = IIF(? = 1, starts_at, ?),
                ends_at = IIF(? = 1, ends_at, ?),
                registration_mode = COALESCE(?, registration_mode),
                invite_limit_attendee = COALESCE(?, invite_limit_attendee),
                settings_json = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        input.settings.name ?? null,
        input.settings.timezone ?? null,
        input.settings.startsAt === undefined ? 1 : 0,
        input.settings.startsAt ?? null,
        input.settings.endsAt === undefined ? 1 : 0,
        input.settings.endsAt ?? null,
        input.settings.registrationMode ?? null,
        input.settings.inviteLimitAttendee ?? null,
        stringifyJson(mergedSettings),
        at,
        event.id,
      ),
  ];
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
  statements.push(
    prepareAuditLog(db, "admin", input.actorId, "event_settings_updated", "event", event.id, input.settings, at),
  );
  await db.batch(statements);

  const [updated, retention] = await Promise.all([
    getEventBySlug(db, input.eventSlug),
    first<{ user_retention_days: number }>(
      db,
      "SELECT user_retention_days FROM retention_policies WHERE event_id = ?",
      [event.id],
    ),
  ]);
  return {
    ...updated,
    user_retention_days: retention?.user_retention_days ?? null,
    settings: parseJsonSafe<Record<string, unknown>>(updated.settings_json, {}),
  };
}
