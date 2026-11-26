import type {
  EventLiveStudioSetupPut,
  EventLiveStudioSetupResponse,
} from "../../../../assets/shared/schemas/live-studio-setup";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import type { EventRecord } from "../events";

const CHANGED = () =>
  new AppError(
    409,
    "LIVE_STUDIO_SETUP_CHANGED",
    "Someone else changed the studio setup since you opened it. Reload and try again.",
  );

/**
 * Replaces the event's studio setup, by the people who set up the live
 * studio, in one atomic batch: the permission check, the write and its audit
 * entry. The write applies only to the version the studio started from, so a
 * save over someone else's newer one is refused. Connected rooms pick the
 * setup up on their next refresh; nothing on air changes.
 */
export async function saveEventLiveStudioSetup(
  db: DatabaseLike,
  input: { event: EventRecord; actor: UserBackedAuthAdmin; request: EventLiveStudioSetupPut },
): Promise<EventLiveStudioSetupResponse> {
  const { event, actor, request } = input;
  const { expectedUpdatedAt, ...setup } = request;
  const json = JSON.stringify(setup);
  const at =
    expectedUpdatedAt === null
      ? nowIso()
      : new Date(Math.max(Date.parse(nowIso()), Date.parse(expectedUpdatedAt) + 1)).toISOString();
  const write =
    expectedUpdatedAt === null
      ? db
          .prepare(
            `INSERT INTO event_live_studio_setups(event_id,setup_json,created_at,updated_at,updated_by_user_id)
             VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`,
          )
          .bind(event.id, json, at, at, actor.id)
      : db
          .prepare(
            `UPDATE event_live_studio_setups SET setup_json=?,updated_at=?,updated_by_user_id=?
              WHERE event_id=? AND updated_at=?`,
          )
          .bind(json, at, actor.id, event.id, expectedUpdatedAt);
  const context = { type: "event", id: event.id };
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "agenda:live_setup", context }]),
      write,
      prepareScopedAuditLogAfterOneChange(
        db,
        context,
        "admin",
        actor.id,
        "live_studio_setup_saved",
        "event",
        event.id,
        { graphics: Object.keys(setup.graphics), layouts: Object.keys(setup.layouts) },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "LIVE_SETTINGS_ACCESS_CHANGED", "Your access to live settings changed.");
    if (isAuditChangeGuardFailure(error)) throw CHANGED();
    throw error;
  }
  return { ...setup, updatedAt: at };
}
