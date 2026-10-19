import { z } from "zod";
import { discardProviderResponseBody } from "../../integrations/provider-failure";
import { readBoundedStream } from "../../utils/bounded-stream";
import { recordingSourceEtagSchema } from "../event-recordings/source-validator";
import {
  realtimeKitRecordingConfigurationSchema,
  realtimeKitRecordingDetailInputSchema,
  realtimeKitRecordingDetailWireSchema,
  realtimeKitRecordingWireSchema,
  realtimeKitRecordingMatchesIdentity,
} from "./realtimekit-recording-contracts";
import type { RealtimeKitMetadataResult, RealtimeKitRecordingConfiguration } from "./realtimekit-recording-contracts";
import {
  fetchRealtimeKitRecordingProvider,
  realtimeKitRecordingDeadlineMs,
  realtimeKitRecordingFailure as failure,
  realtimeKitRecordingProviderBase,
  withRealtimeKitRecordingDeadline,
} from "./realtimekit-recording-provider";

const downloadInputSchema = realtimeKitRecordingDetailInputSchema.extend({
  fileBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 ** 4),
});
const downloadWireSchema = realtimeKitRecordingDetailWireSchema.extend({
  data: realtimeKitRecordingWireSchema.extend({
    download_url: z.string().min(1).max(8192),
    download_url_expiry: realtimeKitRecordingWireSchema.shape.invoked_time,
  }),
});
const deadlineSchema = z.number().int().positive().max(realtimeKitRecordingDeadlineMs);
/** Canonical private configuration policy, also reused by the environment parser. */
export const realtimeKitRecordingDownloadOriginsSchema = z
  .array(
    z.string().refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.hash &&
          !url.search &&
          url.pathname === "/" &&
          value === url.origin
        );
      } catch {
        return false;
      }
    }),
  )
  .min(1)
  .max(100);
export type RealtimeKitRecordingDownloadInput = z.infer<typeof downloadInputSchema>;
/** Internal acquisition authority only; never a public recording DTO or durable URL. */
export interface RealtimeKitRecordingDownload {
  recordingId: string;
  sessionId: string;
  fileBytes: number;
  sourceUrl: string;
  sourceEtag: string;
  expiresAt: string;
}
export interface RealtimeKitRecordingDownloadOptions {
  /** Explicit backend policy. No storage host is inferred from provider responses. */
  configuredOrigins: readonly string[];
  deadlineMs?: number;
  now?: () => number;
}

function downloadLocation(value: string, origins: Set<string>): URL | null {
  try {
    const url = new URL(value);
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      authority?.toLowerCase() !== url.hostname ||
      /\s/.test(value) ||
      hasControlCharacter(value) ||
      !origins.has(url.origin)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
async function probeDownload(
  source: URL,
  fileBytes: number,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<RealtimeKitMetadataResult<string>> {
  signal.throwIfAborted();
  const response = await fetcher(source.toString(), {
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
    signal,
  });
  const etag = recordingSourceEtagSchema.safeParse(response.headers.get("ETag")),
    encoding = response.headers.get("Content-Encoding");
  if (
    response.status !== 206 ||
    response.redirected ||
    (response.url && response.url !== source.toString()) ||
    response.headers.get("Content-Range") !== `bytes 0-0/${fileBytes}` ||
    response.headers.get("Content-Length") !== "1" ||
    (encoding !== null && encoding.toLowerCase() !== "identity") ||
    !etag.success ||
    !response.body
  ) {
    await discardProviderResponseBody(response);
    return failure("invalid_response", response.status);
  }
  const body = await readBoundedStream(response.body, 1, undefined, signal);
  if (!body.ok || body.bytes.length !== 1) return failure("invalid_response", response.status);
  signal.throwIfAborted();
  return { ok: true, value: etag.data };
}

/** Refresh a private signed URL for each acquisition step. The expected tuple and
 * byte count come from the caller's already validated source ownership; a missing
 * provider meeting field grants no new meeting ownership.
 */
export async function getRealtimeKitRecordingDownload(
  config: RealtimeKitRecordingConfiguration | null,
  expected: RealtimeKitRecordingDownloadInput,
  options: RealtimeKitRecordingDownloadOptions,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeKitMetadataResult<RealtimeKitRecordingDownload>> {
  const configuration = realtimeKitRecordingConfigurationSchema.safeParse(config);
  if (!configuration.success) return failure("not_configured", null);
  const request = downloadInputSchema.safeParse(expected);
  const deadline = deadlineSchema.safeParse(options.deadlineMs ?? realtimeKitRecordingDeadlineMs);
  const origins = realtimeKitRecordingDownloadOriginsSchema.safeParse(options.configuredOrigins);
  if (!request.success || !deadline.success || !origins.success) return failure("invalid_request", null);
  const now = options.now ?? Date.now;
  const expiresAfter = now() + deadline.data;
  if (!Number.isSafeInteger(expiresAfter)) return failure("invalid_request", null);
  return withRealtimeKitRecordingDeadline(async (signal) => {
    const url = new URL(`${realtimeKitRecordingProviderBase(configuration.data)}/${request.data.recordingId}`);
    const result = await fetchRealtimeKitRecordingProvider(configuration.data, url, fetcher, signal);
    if (!result.ok) return result;
    const wire = downloadWireSchema.safeParse(result.value);
    if (!wire.success) return failure("invalid_response", 200);
    const recording = wire.data.data;
    if (!realtimeKitRecordingMatchesIdentity(recording, request.data)) return failure("identity_mismatch", 200);
    if (recording.status !== "UPLOADED" || recording.file_size !== request.data.fileBytes)
      return failure("invalid_response", 200);
    const source = downloadLocation(recording.download_url, new Set(origins.data));
    const expiry = Date.parse(recording.download_url_expiry);
    if (!source || expiry <= expiresAfter || expiry <= now()) return failure("invalid_response", 200);
    const probe = await probeDownload(source, request.data.fileBytes, fetcher, signal);
    if (!probe.ok) return probe;
    if (expiry <= now()) return failure("invalid_response", 200);
    return {
      ok: true,
      value: {
        recordingId: request.data.recordingId,
        sessionId: request.data.sessionId,
        fileBytes: request.data.fileBytes,
        sourceUrl: source.toString(),
        sourceEtag: probe.value,
        expiresAt: recording.download_url_expiry,
      },
    };
  }, deadline.data);
}
