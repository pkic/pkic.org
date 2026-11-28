import { STUDIO_WORKSPACES, studioWorkspaceSchema } from "../../../../assets/shared/schemas/live-studio-layout";
import {
  liveStudioGraphicsSetupSchema,
  type EventLiveStudioSetupResponse,
  type LiveStudioSetup,
} from "../../../../assets/shared/schemas/live-studio-setup";
import { readStoredLiveTicker } from "../../../../assets/shared/schemas/live-session-ticker";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { persistedUtcInstant } from "../../utils/time";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A saved ticker as the studio keeps it: the stored form normalized, without the stage's generated segments. */
function readStudioTicker(value: unknown): unknown {
  const ticker = readStoredLiveTicker(value);
  if (ticker === null || typeof ticker !== "object" || !("segments" in ticker)) return ticker;
  const { segments: _segments, ...config } = ticker as Record<string, unknown>;
  return config;
}

/**
 * A stored setup, read part by part: a graphic or workspace that no longer
 * reads takes the built-in setup, and every other part keeps what was saved.
 */
export function readLiveStudioSetupJson(json: string): LiveStudioSetup {
  const stored = record(parseJsonSafe<unknown>(json, null));
  const graphics = record(stored.graphics);
  const layouts = record(stored.layouts);
  const shape = liveStudioGraphicsSetupSchema.shape;
  return {
    graphics: Object.fromEntries(
      (Object.keys(shape) as Array<keyof typeof shape>).flatMap((graphic) => {
        if (graphics[graphic] === undefined) return [];
        const saved = graphic === "ticker" ? readStudioTicker(graphics[graphic]) : graphics[graphic];
        const parsed = shape[graphic].safeParse(saved);
        return parsed.success && parsed.data !== undefined ? [[graphic, parsed.data]] : [];
      }),
    ),
    layouts: Object.fromEntries(
      STUDIO_WORKSPACES.flatMap((workspace) => {
        if (layouts[workspace] === undefined) return [];
        const parsed = studioWorkspaceSchema.safeParse(layouts[workspace]);
        return parsed.success ? [[workspace, parsed.data]] : [];
      }),
    ),
  };
}

/** The event's studio setup and its version; empty, and unversioned, until it saves one. */
export async function readEventLiveStudioSetup(
  db: DatabaseLike,
  eventId: string,
): Promise<EventLiveStudioSetupResponse> {
  const row = await first<{ setup_json: string; updated_at: string }>(
    db,
    "SELECT setup_json,updated_at FROM event_live_studio_setups WHERE event_id=?",
    [eventId],
  );
  if (!row) return { graphics: {}, layouts: {}, updatedAt: null };
  return { ...readLiveStudioSetupJson(row.setup_json), updatedAt: persistedUtcInstant(row.updated_at) };
}
