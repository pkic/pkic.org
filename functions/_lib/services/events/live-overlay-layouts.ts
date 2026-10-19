import { isLiveOverlayPreset } from "../../../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_MAX_SAVED_LAYOUTS,
  type EventLiveOverlayLayoutPut,
  type EventLiveOverlayLayoutsResponse,
  type EventLiveOverlayPositionsPut,
} from "../../../../assets/shared/schemas/live-overlay-layout";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso, persistedUtcInstant } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import type { EventRecord } from "../events";
import { readEventLiveOverlayLayouts } from "../live-session/overlay-layouts";

/**
 * Saving and deleting an event's broadcast overlay layouts and its shared
 * element positions. A change never touches a room's on-air content:
 * connected rooms pick it up on their next refresh and their browser sources
 * redraw.
 */

interface SettingsCommand {
  event: EventRecord;
  actor: UserBackedAuthAdmin;
}
interface LayoutCommand extends SettingsCommand {
  slug: string;
}

const CHANGED = () =>
  new AppError(409, "LIVE_OVERLAY_LAYOUT_CHANGED", "This layout changed since you opened it. Reload and try again.");

async function commit(
  db: DatabaseLike,
  command: SettingsCommand,
  write: StatementLike,
  action: string,
  at: string,
  details: Record<string, unknown>,
  changed: () => AppError = CHANGED,
) {
  const context = { type: "event", id: command.event.id };
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, command.actor, [{ permission: "agenda:live_moderate", context }]),
      write,
      prepareScopedAuditLogAfterOneChange(
        db,
        context,
        "admin",
        command.actor.id,
        action,
        "event",
        command.event.id,
        details,
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "LIVE_SETTINGS_ACCESS_CHANGED", "Your access to live settings changed.");
    if (isAuditChangeGuardFailure(error)) throw changed();
    throw error;
  }
}

async function savedVersion(db: DatabaseLike, eventId: string, slug: string) {
  return first<{ updated_at: string }>(
    db,
    "SELECT updated_at FROM event_live_overlay_layouts WHERE event_id=? AND slug=?",
    [eventId, slug],
  );
}

/**
 * Creates a layout, saves a built-in one for the first time, or replaces a
 * saved one at the version the editor started from.
 */
export async function saveEventLiveOverlayLayout(
  db: DatabaseLike,
  input: LayoutCommand & { request: EventLiveOverlayLayoutPut },
): Promise<EventLiveOverlayLayoutsResponse> {
  const { event, actor, slug, request } = input;
  const elements = JSON.stringify(request.elements);
  const current = await savedVersion(db, event.id, slug);
  let write: StatementLike;
  let at = nowIso();
  if (request.expectedUpdatedAt === null) {
    if (current)
      throw new AppError(409, "LIVE_OVERLAY_LAYOUT_EXISTS", "A layout with this name already exists. Choose another.");
    const count = await first<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM event_live_overlay_layouts WHERE event_id=?",
      [event.id],
    );
    if ((count?.total ?? 0) >= LIVE_OVERLAY_MAX_SAVED_LAYOUTS)
      throw new AppError(
        409,
        "LIVE_OVERLAY_LAYOUT_LIMIT",
        `An event can keep ${LIVE_OVERLAY_MAX_SAVED_LAYOUTS} saved layouts. Delete one before adding another.`,
      );
    write = db
      .prepare(
        `INSERT INTO event_live_overlay_layouts(event_id,slug,name,preset,elements_json,created_at,updated_at,updated_by_user_id)
         SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM event_live_overlay_layouts WHERE event_id=?) < ?
         ON CONFLICT(event_id,slug) DO NOTHING`,
      )
      .bind(
        event.id,
        slug,
        request.name,
        isLiveOverlayPreset(slug) ? slug : request.preset,
        elements,
        at,
        at,
        actor.id,
        event.id,
        LIVE_OVERLAY_MAX_SAVED_LAYOUTS,
      );
  } else {
    if (!current || persistedUtcInstant(current.updated_at) !== request.expectedUpdatedAt) throw CHANGED();
    // A version is an instant; two saves within one millisecond still read as two versions.
    at = new Date(Math.max(Date.parse(at), Date.parse(request.expectedUpdatedAt) + 1)).toISOString();
    write = db
      .prepare(
        `UPDATE event_live_overlay_layouts SET name=?,preset=?,elements_json=?,updated_at=?,updated_by_user_id=?
          WHERE event_id=? AND slug=? AND updated_at=?`,
      )
      .bind(
        request.name,
        isLiveOverlayPreset(slug) ? slug : request.preset,
        elements,
        at,
        actor.id,
        event.id,
        slug,
        current.updated_at,
      );
  }
  await commit(db, input, write, "live_overlay_layout_saved", at, { layout: slug });
  return readEventLiveOverlayLayouts(db, event.id);
}

/** Deletes one of the event's own layouts; built-in ones, the default among them, can only be reset. */
export async function deleteEventLiveOverlayLayout(
  db: DatabaseLike,
  input: LayoutCommand,
): Promise<EventLiveOverlayLayoutsResponse> {
  const { event, slug } = input;
  if (isLiveOverlayPreset(slug))
    throw new AppError(409, "LIVE_OVERLAY_LAYOUT_BUILT_IN", "Built-in layouts can't be deleted. Reset it instead.");
  if (!(await savedVersion(db, event.id, slug)))
    throw new AppError(404, "LIVE_OVERLAY_LAYOUT_NOT_FOUND", "Layout not found.");
  await commit(
    db,
    input,
    db.prepare("DELETE FROM event_live_overlay_layouts WHERE event_id=? AND slug=?").bind(event.id, slug),
    "live_overlay_layout_deleted",
    nowIso(),
    { layout: slug },
  );
  return readEventLiveOverlayLayouts(db, event.id);
}

const POSITIONS_CHANGED = () =>
  new AppError(
    409,
    "LIVE_OVERLAY_POSITIONS_CHANGED",
    "The shared positions changed since you opened them. Reload and try again.",
  );

async function positionsVersion(db: DatabaseLike, eventId: string) {
  return first<{ updated_at: string }>(db, "SELECT updated_at FROM event_live_overlay_positions WHERE event_id=?", [
    eventId,
  ]);
}

/**
 * Saves the event's shared positions, the first time or at the version the
 * editor started from. Every layout element that shares its position moves
 * with it; elements a layout placed itself stay where they are.
 */
export async function saveEventLiveOverlayPositions(
  db: DatabaseLike,
  input: SettingsCommand & { request: EventLiveOverlayPositionsPut },
): Promise<EventLiveOverlayLayoutsResponse> {
  const { event, actor, request } = input;
  const elements = JSON.stringify(request.elements);
  const current = await positionsVersion(db, event.id);
  let at = nowIso();
  let write: StatementLike;
  if (request.expectedUpdatedAt === null) {
    if (current) throw POSITIONS_CHANGED();
    write = db
      .prepare(
        `INSERT INTO event_live_overlay_positions(event_id,elements_json,created_at,updated_at,updated_by_user_id)
         VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind(event.id, elements, at, at, actor.id);
  } else {
    if (!current || persistedUtcInstant(current.updated_at) !== request.expectedUpdatedAt) throw POSITIONS_CHANGED();
    at = new Date(Math.max(Date.parse(at), Date.parse(request.expectedUpdatedAt) + 1)).toISOString();
    write = db
      .prepare(
        `UPDATE event_live_overlay_positions SET elements_json=?,updated_at=?,updated_by_user_id=?
          WHERE event_id=? AND updated_at=?`,
      )
      .bind(elements, at, actor.id, event.id, current.updated_at);
  }
  await commit(db, input, write, "live_overlay_positions_saved", at, {}, POSITIONS_CHANGED);
  return readEventLiveOverlayLayouts(db, event.id);
}

/** Puts the built-in shared positions (Full frame's boxes) back; layouts that share a position move with it. */
export async function resetEventLiveOverlayPositions(
  db: DatabaseLike,
  input: SettingsCommand,
): Promise<EventLiveOverlayLayoutsResponse> {
  const { event } = input;
  if (await positionsVersion(db, event.id))
    await commit(
      db,
      input,
      db.prepare("DELETE FROM event_live_overlay_positions WHERE event_id=?").bind(event.id),
      "live_overlay_positions_reset",
      nowIso(),
      {},
    );
  return readEventLiveOverlayLayouts(db, event.id);
}
