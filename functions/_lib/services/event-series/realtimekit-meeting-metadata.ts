import { z } from "zod";
import {
  eventRecordingProviderMeetingSchema,
  eventRecordingProviderMeetingsQuerySchema,
  eventRecordingProviderMeetingsResponseSchema,
  type EventRecordingProviderMeeting,
  type EventRecordingProviderMeetingsQuery,
  type EventRecordingProviderMeetingsResponse,
} from "../../../../assets/shared/schemas/event-recording-discovery";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  realtimeKitRecordingConfigurationSchema,
  realtimeKitRecordingPagingSchema,
  realtimeKitRecordingWireSchema,
  type RealtimeKitRecordingConfiguration,
  type RealtimeKitMetadataResult,
} from "./realtimekit-recording-contracts";
import {
  fetchRealtimeKitRecordingProvider,
  realtimeKitRecordingFailure as failure,
  realtimeKitRecordingProviderBase,
  withRealtimeKitRecordingDeadline,
} from "./realtimekit-recording-provider";

const meetingWireSchema = z.object({
  id: eventRecordingProviderMeetingSchema.shape.providerMeetingId,
  title: eventRecordingProviderMeetingSchema.shape.title,
  status: eventRecordingProviderMeetingSchema.shape.status,
  created_at: realtimeKitRecordingWireSchema.shape.invoked_time,
  updated_at: realtimeKitRecordingWireSchema.shape.invoked_time,
});
const listWireSchema = z.object({
  success: z.literal(true),
  data: z.array(meetingWireSchema).max(100),
  paging: z.object({
    start_offset: realtimeKitRecordingPagingSchema.shape.startOffset,
    end_offset: realtimeKitRecordingPagingSchema.shape.endOffset,
    total_count: realtimeKitRecordingPagingSchema.shape.totalCount,
  }),
});
const detailWireSchema = z.object({ success: z.literal(true), data: meetingWireSchema });
function meetingMetadata(value: z.infer<typeof meetingWireSchema>): EventRecordingProviderMeeting {
  return eventRecordingProviderMeetingSchema.parse({
    providerMeetingId: value.id,
    title: value.title,
    status: value.status,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
}

/** A bounded chooser in the configured app. It grants no event or occurrence ownership. */
export async function listRealtimeKitMeetingMetadata(
  config: RealtimeKitRecordingConfiguration | null,
  query: EventRecordingProviderMeetingsQuery,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeKitMetadataResult<EventRecordingProviderMeetingsResponse>> {
  const configuration = realtimeKitRecordingConfigurationSchema.safeParse(config);
  if (!configuration.success) return failure("not_configured", null);
  const request = eventRecordingProviderMeetingsQuerySchema.safeParse(query);
  if (!request.success) return failure("invalid_request", null);
  const url = new URL(realtimeKitRecordingProviderBase(configuration.data, "meetings"));
  url.searchParams.set("page_no", String(request.data.offset / request.data.limit));
  url.searchParams.set("per_page", String(request.data.limit));
  if (request.data.q) url.searchParams.set("search", request.data.q);
  if (request.data.status) url.searchParams.set("status", request.data.status);
  return withRealtimeKitRecordingDeadline(async (signal) => {
    const result = await fetchRealtimeKitRecordingProvider(configuration.data, url, fetcher, signal, "meetings");
    if (!result.ok) return result;
    const wire = listWireSchema.safeParse(result.value);
    if (!wire.success) return failure("invalid_response", 200);
    const rows = wire.data.data;
    if (
      rows.length > request.data.limit ||
      rows.length > wire.data.paging.total_count ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      (rows.length > 0 &&
        (wire.data.paging.start_offset > wire.data.paging.end_offset ||
          wire.data.paging.end_offset > wire.data.paging.total_count)) ||
      (request.data.status !== undefined && rows.some((row) => row.status !== request.data.status))
    )
      return failure("invalid_response", 200);
    return {
      ok: true,
      value: eventRecordingProviderMeetingsResponseSchema.parse({
        meetings: rows.map(meetingMetadata),
        page: buildPageInfo(request.data.limit, request.data.offset, wire.data.paging.total_count, rows.length),
      }),
    };
  });
}

/** Re-read exact app-owned identity before the caller's explicit linking command. */
export async function getRealtimeKitMeetingMetadata(
  config: RealtimeKitRecordingConfiguration | null,
  meetingId: string,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeKitMetadataResult<EventRecordingProviderMeeting>> {
  const configuration = realtimeKitRecordingConfigurationSchema.safeParse(config);
  if (!configuration.success) return failure("not_configured", null);
  if (!eventRecordingProviderMeetingSchema.shape.providerMeetingId.safeParse(meetingId).success)
    return failure("invalid_request", null);
  const url = new URL(`${realtimeKitRecordingProviderBase(configuration.data, "meetings")}/${meetingId}`);
  return withRealtimeKitRecordingDeadline(async (signal) => {
    const result = await fetchRealtimeKitRecordingProvider(configuration.data, url, fetcher, signal, "meetings");
    if (!result.ok) return result;
    const wire = detailWireSchema.safeParse(result.value);
    if (!wire.success) return failure("invalid_response", 200);
    if (wire.data.data.id !== meetingId) return failure("identity_mismatch", 200);
    return { ok: true, value: meetingMetadata(wire.data.data) };
  });
}
