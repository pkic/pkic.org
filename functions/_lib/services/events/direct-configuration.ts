import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { AppError } from "../../errors";
import type { EventRecord } from "../events";

interface DirectEventStateRow {
  series_id: string | null;
}

/** Direct event routes never write group-owned or meeting-series-owned resources. */
export async function requireDirectEventConfiguration(db: DatabaseLike, event: EventRecord): Promise<void> {
  if (event.owner_group_id || event.source_mode === "portal") {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_GROUP",
      "Group-owned events must be configured through their owning group",
    );
  }
  const state = await first<DirectEventStateRow>(
    db,
    "SELECT id AS series_id FROM event_series WHERE event_id = ? LIMIT 1",
    [event.id],
  );
  if (event.profile_key === "meeting" || event.profile_key === "board_meeting" || state?.series_id) {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_MEETING_SERIES",
      "Meeting events must be configured through their meeting series",
    );
  }
}

export function prepareDirectEventConfigurationGuard(db: DatabaseLike, eventId: string): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM events guarded_event
           WHERE guarded_event.id = ?
             AND guarded_event.owner_group_id IS NULL
             AND COALESCE(guarded_event.source_mode, '') <> 'portal'
             AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
             AND NOT EXISTS (
               SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
             )`,
    bindings: [eventId],
  });
}

export function throwEventConfigurationConflict(error: unknown): never {
  if (isAuthorizationGuardFailure(error)) {
    throw new AppError(
      409,
      "EVENT_CONFIGURATION_CONTEXT_CHANGED",
      "Event ownership, meeting-series state, or write permission changed before the update was saved",
    );
  }
  throw error;
}
