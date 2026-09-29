import type { z } from "zod";
import type { eventSeriesCreateSchema } from "../../../../assets/shared/schemas/event-series";
import type { DatabaseLike } from "../../types";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";

/** Scheduling a migrated draft preserves its event ID and all linked records. */
export function prepareSeriesEvent(
  db: DatabaseLike,
  input: z.output<typeof eventSeriesCreateSchema>,
  context: { eventId: string; groupId: string; groupSlug: string; slug: string; settings: string; now: string },
) {
  const { eventId, groupId, groupSlug, slug, settings, now } = context;
  if (input.existingEventId) {
    return [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM events WHERE id = ? AND owner_group_id = ? AND source_mode = 'portal'
          AND profile_key IN ('meeting', 'board_meeting')
          AND NOT EXISTS (SELECT 1 FROM event_series WHERE event_id = events.id)`,
        bindings: [eventId, groupId],
      }),
      db
        .prepare(
          `UPDATE events SET name = ?, timezone = ?, registration_mode = ?, visibility = ?,
        profile_key = ?, settings_json = json_patch(CASE WHEN json_valid(settings_json) THEN settings_json ELSE '{}' END, ?),
        updated_at = ? WHERE id = ? AND owner_group_id = ?`,
        )
        .bind(
          input.eventName,
          input.timezone,
          input.policy.registrationPolicy,
          input.policy.visibility,
          input.profileKey,
          settings,
          now,
          eventId,
          groupId,
        ),
    ];
  }
  return [
    db
      .prepare(
        `INSERT INTO events
    (id, slug, name, timezone, starts_at, ends_at, source_path, base_path,
      capacity_in_person, registration_mode, invite_limit_attendee, settings_json,
      visibility, created_at, updated_at, owner_group_id, profile_key, source_mode, links_json)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, 'portal', NULL)`,
      )
      .bind(
        eventId,
        slug,
        input.eventName,
        input.timezone,
        `/portal/groups/${groupSlug}/meetings`,
        input.policy.registrationPolicy,
        settings,
        input.policy.visibility,
        now,
        now,
        groupId,
        input.profileKey,
      ),
  ];
}
