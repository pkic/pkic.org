import {
  eventRecordingDiscoveryResponseSchema,
  type EventRecordingDiscoveryQuery,
  type EventRecordingProviderMeetingsQuery,
} from "../../../../assets/shared/schemas/event-recording-discovery";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import {
  realtimeKitRecordingConfigurationSchema,
  type RealtimeKitRecordingConfiguration,
} from "../event-series/realtimekit-recording-contracts";
import { listRealtimeKitRecordingMetadata } from "../event-series/realtimekit-recording-metadata";
import { listRealtimeKitMeetingMetadata } from "../event-series/realtimekit-meeting-metadata";
import { humanRecordingDatabase, humanRecordingProviderDatabase } from "./authorization";
import { readOwnedRecordingMeetingLink, recordingMeetingMetadata } from "./meeting-links";

async function requireOwnedEvent(db: DatabaseLike, eventId: string) {
  if (!(await first(db, "SELECT id FROM events WHERE id=?", [eventId])))
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
}
function configuredProvider(configuration: RealtimeKitRecordingConfiguration | null) {
  const config = realtimeKitRecordingConfigurationSchema.safeParse(configuration);
  if (!config.success) throw new AppError(503, "RECORDING_NOT_CONFIGURED", "Recording discovery is not configured.");
  return config.data;
}

/** The manager chooses app-owned metadata, then explicitly establishes event association through the link command. */
export async function discoverRecordingProviderMeetings(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: EventRecordingProviderMeetingsQuery,
  configuration: RealtimeKitRecordingConfiguration | null,
  fetcher: typeof fetch = fetch,
) {
  const guarded = humanRecordingProviderDatabase(db, actor);
  await requireOwnedEvent(guarded, eventId);
  const observed = await listRealtimeKitMeetingMetadata(configuredProvider(configuration), query, fetcher);
  if (!observed.ok) throw new AppError(503, "RECORDING_DISCOVERY_UNAVAILABLE", "Recording discovery is unavailable.");
  // Provider latency cannot preserve a permission or session revoked while the request was in flight.
  await requireOwnedEvent(guarded, eventId);
  return observed.value;
}

/** The caller selects only an immutable event-owned link, never an arbitrary provider meeting. */
export async function discoverEventRecordings(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: EventRecordingDiscoveryQuery,
  configuration: RealtimeKitRecordingConfiguration | null,
  fetcher: typeof fetch = fetch,
) {
  const guarded = humanRecordingDatabase(db, actor, eventId);
  await requireOwnedEvent(guarded, eventId);
  const config = configuredProvider(configuration);
  const meeting = await readOwnedRecordingMeetingLink(guarded, eventId, query.meetingLinkId, config);
  if (!meeting) throw new AppError(404, "RECORDING_MEETING_NOT_FOUND", "The linked recording meeting was not found.");
  const observed = await listRealtimeKitRecordingMetadata(
    config,
    {
      meetingId: meeting.provider_meeting_id,
      page: query.offset / 100,
      limit: query.limit,
    },
    fetcher,
  );
  if (!observed.ok) throw new AppError(503, "RECORDING_DISCOVERY_UNAVAILABLE", "Recording discovery is unavailable.");
  const current = await readOwnedRecordingMeetingLink(guarded, eventId, query.meetingLinkId, config);
  if (!current) throw new AppError(409, "RECORDING_MEETING_CHANGED", "The linked recording meeting changed.");
  return eventRecordingDiscoveryResponseSchema.parse({
    meeting: recordingMeetingMetadata(current),
    recordings: observed.value.rows.map((row) => ({ ...row, stoppedAt: row.stoppedAt ?? null })),
    page: buildPageInfo(query.limit, query.offset, observed.value.paging.totalCount, observed.value.rows.length),
  });
}
