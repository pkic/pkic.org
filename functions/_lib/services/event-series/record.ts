import {
  eventOccurrenceGuestSchema,
  eventOccurrenceSchema,
  eventSeriesSchema,
  type EventGuestPolicy,
  type EventSeries,
} from "../../../../assets/shared/schemas/event-series";
import { parseJsonSafe } from "../../utils/json";

export interface EventSeriesRow {
  id: string;
  event_id: string;
  owner_group_id: string;
  event_name: string;
  event_slug: string;
  profile_key: EventSeries["profileKey"];
  registration_policy: EventSeries["registrationPolicy"];
  settings_json: string;
  starts_at: string;
  recurrence_rule: string;
  timezone: string;
  duration_minutes: number;
  location: string | null;
  provider_type: EventSeries["providerType"];
  provider_data_json: string | null;
  active: number;
  next_occurrence_at: string | null;
  created_at: string;
  updated_at: string;
}

export const EVENT_SERIES_SELECT = `SELECT series.id, series.event_id, event.owner_group_id,
  event.name AS event_name, event.slug AS event_slug, event.profile_key,
  event.registration_mode AS registration_policy, event.settings_json,
  series.starts_at, series.recurrence_rule, series.timezone, series.duration_minutes, series.location,
  series.provider_type, series.provider_data_json, series.active,
  (SELECT MIN(next_occurrence.starts_at) FROM event_occurrences next_occurrence
    WHERE next_occurrence.series_id = series.id
      AND next_occurrence.status = 'scheduled'
      AND next_occurrence.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS next_occurrence_at,
  series.created_at, MAX(series.updated_at, event.updated_at) AS updated_at`;

export const EVENT_SERIES_FROM = `FROM event_series series
  JOIN events event ON event.id = series.event_id`;

export function eventGuestPolicyFromSettings(settingsJson: string): EventGuestPolicy {
  const raw = parseJsonSafe<Record<string, unknown>>(settingsJson, {}).guestPolicy;
  if (raw === "invitation_only") return "occurrence_invitation";
  if (raw === "occurrence_invitation" || raw === "public_registration") return raw;
  return "none";
}

export function toEventSeries(row: EventSeriesRow): EventSeries {
  const settings = parseJsonSafe<Record<string, unknown>>(row.settings_json, {});
  const rawEligibility = settings.memberEligibility;
  return eventSeriesSchema.parse({
    id: row.id,
    eventId: row.event_id,
    ownerGroupId: row.owner_group_id,
    eventName: row.event_name,
    eventSlug: row.event_slug,
    profileKey: row.profile_key,
    registrationPolicy: row.registration_policy,
    memberEligibility: rawEligibility === "group" ? "owner_group" : rawEligibility,
    guestPolicy: eventGuestPolicyFromSettings(row.settings_json),
    startsAt: row.starts_at,
    recurrenceRule: row.recurrence_rule,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    location: row.location,
    providerType: row.provider_type,
    providerConfigured: row.provider_data_json !== null,
    active: row.active === 1,
    nextOccurrenceAt: row.next_occurrence_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface EventOccurrenceRow {
  id: string;
  series_id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled" | "completed";
  location_override: string | null;
  location: string | null;
  provider_join_url_ciphertext: string | null;
  guest_count: number;
  join_confirmed_count: number;
  attendance_verified_count: number;
  created_at: string;
  updated_at: string;
}

export function toEventOccurrence(row: EventOccurrenceRow) {
  return eventOccurrenceSchema.parse({
    id: row.id,
    seriesId: row.series_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    locationOverride: row.location_override,
    location: row.location,
    providerConfigured: row.provider_join_url_ciphertext !== null,
    guestCount: row.guest_count,
    joinConfirmedCount: row.join_confirmed_count,
    attendanceVerifiedCount: row.attendance_verified_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface EventGuestRow {
  id: string;
  series_id: string;
  occurrence_id: string | null;
  response_occurrence_id?: string;
  user_id: string | null;
  normalized_email: string;
  name: string;
  affiliation: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toEventGuest(row: EventGuestRow) {
  return eventOccurrenceGuestSchema.parse({
    id: row.id,
    seriesId: row.series_id,
    occurrenceId: row.occurrence_id ?? row.response_occurrence_id,
    seriesWide: row.occurrence_id === null,
    userId: row.user_id,
    email: row.normalized_email,
    name: row.name,
    affiliation: row.affiliation,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
