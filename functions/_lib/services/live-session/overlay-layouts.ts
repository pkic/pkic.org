import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  isLiveOverlayPreset,
  resolveLiveOverlayElements,
} from "../../../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_MAX_SAVED_LAYOUTS,
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutsResponseSchema,
  liveOverlayLayoutElementsSchema,
  liveOverlaySharedPositionsSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayLayout,
  type LiveOverlayLayoutGeometry,
  type LiveOverlayPositions,
} from "../../../../assets/shared/schemas/live-overlay-layout";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { persistedUtcInstant } from "../../utils/time";

interface SavedLayoutRow {
  slug: string;
  name: string;
  preset: string | null;
  elements_json: string;
  updated_at: string;
}

/**
 * The event's saved layouts, oldest first. A row whose elements no longer
 * read is left out, so a browser source falls back to the built-in layout.
 */
async function readSavedLayouts(db: DatabaseLike, eventId: string) {
  const rows = await all<SavedLayoutRow>(
    db,
    `SELECT slug,name,preset,elements_json,updated_at FROM event_live_overlay_layouts
      WHERE event_id=? ORDER BY created_at,slug LIMIT ?`,
    [eventId, LIVE_OVERLAY_MAX_SAVED_LAYOUTS],
  );
  return rows.flatMap((row) => {
    const elements = liveOverlayLayoutElementsSchema.safeParse(parseJsonSafe<unknown>(row.elements_json, null));
    return elements.success ? [{ ...row, elements: elements.data }] : [];
  });
}

/** The event's shared positions; the built-in ones until saved, or when the saved ones no longer read. */
export async function readLiveOverlayPositions(db: DatabaseLike, eventId: string): Promise<LiveOverlayPositions> {
  const row = await first<{ elements_json: string; updated_at: string }>(
    db,
    "SELECT elements_json,updated_at FROM event_live_overlay_positions WHERE event_id=?",
    [eventId],
  );
  const elements = row
    ? liveOverlaySharedPositionsSchema.safeParse(parseJsonSafe<unknown>(row.elements_json, null))
    : null;
  return row && elements?.success
    ? { elements: elements.data, saved: true, updatedAt: persistedUtcInstant(row.updated_at) }
    : { elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null };
}

/** Every layout an organizer can pick, as stored: the built-in ones, saved or not, then the event's own. */
async function readLayouts(db: DatabaseLike, eventId: string): Promise<LiveOverlayLayout[]> {
  const saved = await readSavedLayouts(db, eventId);
  const bySlug = new Map(saved.map((row) => [row.slug, row]));
  const builtIn = LIVE_OVERLAY_PRESETS.map((preset): LiveOverlayLayout => {
    const row = bySlug.get(preset);
    return row
      ? {
          slug: preset,
          name: row.name,
          preset,
          builtIn: true,
          saved: true,
          elements: row.elements,
          updatedAt: persistedUtcInstant(row.updated_at),
        }
      : {
          slug: preset,
          ...LIVE_OVERLAY_PRESET_LAYOUTS[preset],
          preset,
          builtIn: true,
          saved: false,
          updatedAt: null,
        };
  });
  const own = saved
    .filter((row) => !isLiveOverlayPreset(row.slug))
    .map((row): LiveOverlayLayout => ({
      slug: row.slug,
      name: row.name,
      preset: row.preset && isLiveOverlayPreset(row.preset) ? row.preset : null,
      builtIn: false,
      saved: true,
      elements: row.elements,
      updatedAt: persistedUtcInstant(row.updated_at),
    }));
  return [...builtIn, ...own];
}

/**
 * What a live room hands its browser sources: every layout's geometry, each
 * shared element at the event's shared position, so a source draws exactly
 * what the layout editor shows.
 */
export async function readLiveOverlayLayoutGeometries(
  db: DatabaseLike,
  eventId: string,
): Promise<LiveOverlayLayoutGeometry[]> {
  const [layouts, positions] = await Promise.all([readLayouts(db, eventId), readLiveOverlayPositions(db, eventId)]);
  return layouts.map(({ slug, name, elements }) => ({
    slug,
    name,
    elements: resolveLiveOverlayElements(elements, positions.elements),
  }));
}

/** Every layout an organizer can pick, each shared element at the shared position, and those positions. */
export async function readEventLiveOverlayLayouts(
  db: DatabaseLike,
  eventId: string,
): Promise<EventLiveOverlayLayoutsResponse> {
  const [layouts, positions] = await Promise.all([readLayouts(db, eventId), readLiveOverlayPositions(db, eventId)]);
  return eventLiveOverlayLayoutsResponseSchema.parse({
    layouts: layouts.map((layout) => ({
      ...layout,
      elements: resolveLiveOverlayElements(layout.elements, positions.elements),
    })),
    positions,
  });
}
