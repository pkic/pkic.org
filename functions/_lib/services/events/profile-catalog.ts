import { STANDALONE_EVENT_PROFILE_KEYS } from "../../../../assets/shared/schemas/event-series";
import type { EventProfileCatalogItem } from "../../../../assets/shared/schemas/event-management";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

interface EventProfileRow {
  key: string;
  label: string;
  description: string | null;
}

/**
 * Reads the active event-profile catalog from D1. Profile presentation is
 * intentionally not hardcoded in the portal; only the controlled distinction
 * between series-only meeting profiles and standalone profiles is shared with
 * the event creation policy.
 */
export async function listActiveEventProfiles(db: DatabaseLike): Promise<EventProfileCatalogItem[]> {
  const rows = await all<EventProfileRow>(
    db,
    `SELECT key, label, description
       FROM event_profiles
      WHERE active = 1
      ORDER BY sort_order ASC, label ASC, key ASC`,
  );
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    standaloneEligible: (STANDALONE_EVENT_PROFILE_KEYS as readonly string[]).includes(row.key),
  }));
}
