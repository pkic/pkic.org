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
  invite_limit_attendee: number;
  invite_limit_speaker_nomination: number;
  settings_json: string;
  /** Ownership and source metadata introduced by the group-centered event model. */
  owner_group_id?: string | null;
  profile_key?: string | null;
  source_mode?: EventSourceMode | null;
  links_json?: string | null;
}

export const EVENT_COLUMNS = `id, slug, name, timezone, starts_at, ends_at, source_path, base_path,
  capacity_in_person, registration_mode, invite_limit_attendee, invite_limit_speaker_nomination, settings_json,
  owner_group_id, profile_key, source_mode, links_json`;

export interface EventTermRecord {
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}
