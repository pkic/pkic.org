import type { EventSourceMode } from "../../../assets/shared/schemas/event-series";

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  /** @deprecated Use base_path instead. Kept in DB but no longer read by application code. */
  source_path: string | null;
  /** Canonical frontend URL prefix, recorded from the Hugo event page. */
  base_path: string | null;
  capacity_in_person: number | null;
  registration_mode: string;
  visibility: string;
  invite_limit_attendee: number;
  invite_limit_speaker_nomination: number;
  settings_json: string;
  /** Ownership and source metadata introduced by the group-centered event model. */
  owner_group_id?: string | null;
  profile_key?: string | null;
  source_mode?: EventSourceMode | null;
  links_json?: string | null;
  updated_at: string;
}

export const EVENT_COLUMN_NAMES = [
  "id",
  "slug",
  "name",
  "timezone",
  "starts_at",
  "ends_at",
  "source_path",
  "base_path",
  "capacity_in_person",
  "registration_mode",
  "visibility",
  "invite_limit_attendee",
  "invite_limit_speaker_nomination",
  "settings_json",
  "owner_group_id",
  "profile_key",
  "source_mode",
  "links_json",
  "updated_at",
] as const;

/** One canonical event projection, optionally qualified for joined read models. */
export function eventColumns(tableAlias?: string): string {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  return EVENT_COLUMN_NAMES.map((column) => `${prefix}${column}`).join(", ");
}

export const EVENT_COLUMNS = eventColumns();

export interface EventTermRecord {
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}
