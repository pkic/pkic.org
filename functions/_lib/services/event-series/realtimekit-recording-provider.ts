import { discardProviderResponseBody } from "../../integrations/provider-failure";
import { readBoundedStream } from "../../utils/bounded-stream";
import type {
  RealtimeKitMetadataFailure,
  RealtimeKitMetadataResult,
  RealtimeKitRecordingConfiguration,
} from "./realtimekit-recording-contracts";

const metadataMaxBytes = 1_048_576;
export const realtimeKitRecordingDeadlineMs = 15_000;

export function realtimeKitRecordingFailure(
  kind: RealtimeKitMetadataFailure["kind"],
  status: number | null,
): { ok: false; error: RealtimeKitMetadataFailure } {
  return { ok: false, error: { kind, status } };
}

export function realtimeKitRecordingProviderBase(
  config: RealtimeKitRecordingConfiguration,
  collection: "recordings" | "meetings" = "recordings",
): string {
  return `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}/${collection}`;
}

/** Private fixed-provider JSON transport. A download URL never enters this authenticated request. */
export async function fetchRealtimeKitRecordingProvider(
  config: RealtimeKitRecordingConfiguration,
  url: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
  collection: "recordings" | "meetings" = "recordings",
): Promise<RealtimeKitMetadataResult<unknown>> {
  const base = new URL(realtimeKitRecordingProviderBase(config, collection));
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    (url.pathname !== base.pathname && !url.pathname.startsWith(`${base.pathname}/`))
  )
    return realtimeKitRecordingFailure("invalid_request", null);
  try {
    signal.throwIfAborted();
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
      return realtimeKitRecordingFailure(kind, response.status);
    }
    if (response.status !== 200 || response.redirected || (response.url && response.url !== url.toString())) {
      await discardProviderResponseBody(response);
      return realtimeKitRecordingFailure("invalid_response", response.status);
    }
    const body = await readBoundedStream(response.body, metadataMaxBytes, undefined, signal);
    if (!body.ok) return realtimeKitRecordingFailure("invalid_response", response.status);
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
      return { ok: true, value };
    } catch {
      return realtimeKitRecordingFailure("invalid_response", response.status);
    }
  } catch {
    // Neither provider diagnostics nor thrown request URLs cross this boundary.
    return realtimeKitRecordingFailure("temporarily_unavailable", null);
  }
}

/** A single deadline covers provider headers, JSON body, cancellation, and any download probe. */
export async function withRealtimeKitRecordingDeadline<T>(
  run: (signal: AbortSignal) => Promise<RealtimeKitMetadataResult<T>>,
  milliseconds = realtimeKitRecordingDeadlineMs,
): Promise<RealtimeKitMetadataResult<T>> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > realtimeKitRecordingDeadlineMs)
    return realtimeKitRecordingFailure("invalid_request", null);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RealtimeKitMetadataResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(realtimeKitRecordingFailure("temporarily_unavailable", null));
    }, milliseconds);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } catch {
    return realtimeKitRecordingFailure("temporarily_unavailable", null);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
