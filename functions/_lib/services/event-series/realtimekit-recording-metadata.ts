import { discardProviderResponseBody } from "../../integrations/provider-failure";
import { readBoundedStream } from "../../utils/bounded-stream";
import {
  recordingMetadataFromWire,
  realtimeKitRecordingConfigurationSchema,
  realtimeKitRecordingDetailInputSchema,
  realtimeKitRecordingDetailWireSchema,
  realtimeKitRecordingListInputSchema,
  realtimeKitRecordingListWireSchema,
  realtimeKitRecordingPageSchema,
} from "./realtimekit-recording-contracts";
import type {
  RealtimeKitMetadataFailure,
  RealtimeKitMetadataResult,
  RealtimeKitRecordingConfiguration,
  RealtimeKitRecordingDetailInput,
  RealtimeKitRecordingListInput,
  RealtimeKitRecordingMetadata,
  RealtimeKitRecordingPage,
} from "./realtimekit-recording-contracts";

const METADATA_MAX_BYTES = 1_048_576;
const METADATA_TIMEOUT_MS = 15_000;

function failure(
  kind: RealtimeKitMetadataFailure["kind"],
  status: number | null,
): { ok: false; error: RealtimeKitMetadataFailure } {
  return { ok: false, error: { kind, status } };
}

function providerBase(config: RealtimeKitRecordingConfiguration): string {
  return `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}/recordings`;
}

async function fetchProviderMetadata(
  config: RealtimeKitRecordingConfiguration,
  url: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<RealtimeKitMetadataResult<unknown>> {
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiToken}`, Accept: "application/json" },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await discardProviderResponseBody(response);
      const kind =
        response.status === 404
          ? "not_found"
          : response.status === 429 || response.status >= 500
            ? "temporarily_unavailable"
            : "provider_refused";
      return failure(kind, response.status);
    }
    if (response.status !== 200) {
      await discardProviderResponseBody(response);
      return failure("invalid_response", response.status);
    }
    const body = await readBoundedStream(response.body, METADATA_MAX_BYTES, undefined, signal);
    if (!body.ok) return failure("invalid_response", response.status);
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
      return { ok: true, value };
    } catch {
      return failure("invalid_response", response.status);
    }
  } catch {
    // Neither provider diagnostics nor thrown request URLs cross this boundary.
    return failure("temporarily_unavailable", null);
  }
}

async function readProviderMetadata(
  config: RealtimeKitRecordingConfiguration,
  url: URL,
  fetcher: typeof fetch,
): Promise<RealtimeKitMetadataResult<unknown>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RealtimeKitMetadataResult<unknown>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failure("temporarily_unavailable", null));
    }, METADATA_TIMEOUT_MS);
  });
  try {
    // The deadline also bounds body reads and an unsuccessful body's cancellation.
    return await Promise.race([fetchProviderMetadata(config, url, fetcher, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
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
  if (wire.data.data.some((row) => row.meeting !== undefined && row.meeting.id !== request.data.meetingId)) {
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
  if (wire.data.data.id !== request.data.recordingId || wire.data.data.session_id !== request.data.sessionId) {
    return failure("identity_mismatch", 200);
  }
  return { ok: true, value: recordingMetadataFromWire(wire.data.data) };
}
