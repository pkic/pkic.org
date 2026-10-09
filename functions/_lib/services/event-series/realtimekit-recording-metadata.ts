import {
  recordingMetadataFromWire,
  realtimeKitRecordingConfigurationSchema,
  realtimeKitRecordingDetailInputSchema,
  realtimeKitRecordingDetailWireSchema,
  realtimeKitRecordingListInputSchema,
  realtimeKitRecordingListWireSchema,
  realtimeKitRecordingPageSchema,
  realtimeKitRecordingMatchesIdentity,
  realtimeKitRecordingMatchesMeeting,
} from "./realtimekit-recording-contracts";
import type {
  RealtimeKitMetadataResult,
  RealtimeKitRecordingConfiguration,
  RealtimeKitRecordingDetailInput,
  RealtimeKitRecordingListInput,
  RealtimeKitRecordingMetadata,
  RealtimeKitRecordingPage,
} from "./realtimekit-recording-contracts";
import {
  fetchRealtimeKitRecordingProvider,
  realtimeKitRecordingFailure as failure,
  realtimeKitRecordingProviderBase as providerBase,
  withRealtimeKitRecordingDeadline,
} from "./realtimekit-recording-provider";

async function readProviderMetadata(
  config: RealtimeKitRecordingConfiguration,
  url: URL,
  fetcher: typeof fetch,
): Promise<RealtimeKitMetadataResult<unknown>> {
  return withRealtimeKitRecordingDeadline((signal) => fetchRealtimeKitRecordingProvider(config, url, fetcher, signal));
}

/** One bounded observation filtered to an exact provider meeting; no inventory crawl or archive authority. */
export async function listRealtimeKitRecordingMetadata(
  config: RealtimeKitRecordingConfiguration | null,
  input: RealtimeKitRecordingListInput,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeKitMetadataResult<RealtimeKitRecordingPage>> {
  const configuration = realtimeKitRecordingConfigurationSchema.safeParse(config);
  if (!configuration.success) return failure("not_configured", null);
  const request = realtimeKitRecordingListInputSchema.safeParse(input);
  if (!request.success) return failure("invalid_request", null);
  const url = new URL(providerBase(configuration.data));
  url.searchParams.set("meeting_id", request.data.meetingId);
  url.searchParams.set("page_no", String(request.data.page));
  url.searchParams.set("per_page", String(request.data.limit));
  url.searchParams.set("sort_by", "invokedTime");
  url.searchParams.set("sort_order", "ASC");
  const result = await readProviderMetadata(configuration.data, url, fetcher);
  if (!result.ok) return result;
  const wire = realtimeKitRecordingListWireSchema.safeParse(result.value);
  if (!wire.success) return failure("invalid_response", 200);
  if (wire.data.data.some((row) => !realtimeKitRecordingMatchesMeeting(row, request.data.meetingId))) {
    return failure("identity_mismatch", 200);
  }
  const rows = wire.data.data.map(recordingMetadataFromWire);
  if (
    rows.length > request.data.limit ||
    new Set(rows.map((row) => row.recordingId)).size !== rows.length ||
    rows.length > wire.data.paging.total_count
  )
    return failure("invalid_response", 200);
  const page = realtimeKitRecordingPageSchema.safeParse({
    meetingId: request.data.meetingId,
    rows,
    paging: {
      startOffset: wire.data.paging.start_offset,
      endOffset: wire.data.paging.end_offset,
      totalCount: wire.data.paging.total_count,
    },
  });
  return page.success ? { ok: true, value: page.data } : failure("invalid_response", 200);
}

/** The caller must obtain this tuple from owned discovery/source evidence; detail alone proves no meeting ownership. */
export async function getRealtimeKitRecordingMetadata(
  config: RealtimeKitRecordingConfiguration | null,
  expected: RealtimeKitRecordingDetailInput,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeKitMetadataResult<RealtimeKitRecordingMetadata>> {
  const configuration = realtimeKitRecordingConfigurationSchema.safeParse(config);
  if (!configuration.success) return failure("not_configured", null);
  const request = realtimeKitRecordingDetailInputSchema.safeParse(expected);
  if (!request.success) return failure("invalid_request", null);
  const url = new URL(`${providerBase(configuration.data)}/${request.data.recordingId}`);
  const result = await readProviderMetadata(configuration.data, url, fetcher);
  if (!result.ok) return result;
  const wire = realtimeKitRecordingDetailWireSchema.safeParse(result.value);
  if (!wire.success) return failure("invalid_response", 200);
  if (!realtimeKitRecordingMatchesIdentity(wire.data.data, request.data)) {
    return failure("identity_mismatch", 200);
  }
  return { ok: true, value: recordingMetadataFromWire(wire.data.data) };
}
