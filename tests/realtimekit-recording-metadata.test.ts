import { afterEach, describe, expect, it, vi } from "vitest";
import { realtimeKitRecordingStatusSchema } from "../assets/shared/schemas/event-recordings";
import {
  getRealtimeKitRecordingMetadata,
  listRealtimeKitRecordingMetadata,
} from "../functions/_lib/services/event-series/realtimekit-recording-metadata";
import {
  realtimeKitRecordingMetadataSchema,
  realtimeKitRecordingPageSchema,
} from "../functions/_lib/services/event-series/realtimekit-recording-contracts";

const configuration = {
  accountId: "0123456789abcdef0123456789abcdef",
  appId: "synthetic-app",
  apiToken: "synthetic-only-api-token",
};
const meetingId = "10000000-0000-4000-8000-000000000001";
const recordingId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const foreignId = "40000000-0000-4000-8000-000000000001";
const input = { meetingId, page: 0, limit: 2 };
const expected = { recordingId, sessionId, meetingId };
const sentinel = "PRIVATE_PROVIDER_BODY person@example.test";

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: recordingId,
    session_id: sessionId,
    status: "UPLOADED",
    invoked_time: "2026-10-07T12:00:00Z",
    started_time: "2026-10-07T14:00:05+02:00",
    stopped_time: "2026-10-07T12:30:00.000Z",
    file_size: 12345,
    meeting: { id: meetingId, title: sentinel, storage_config: { secret: sentinel } },
    download_url: `https://provider.test/${sentinel}`,
    output_file_name: sentinel,
    storage_config: { password: sentinel },
    ...overrides,
  };
}

function page(rows = [recording()], paging = { start_offset: 1, end_offset: 1, total_count: 3 }) {
  return { success: true, data: rows, paging };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RealtimeKit recording metadata observations", () => {
  it("requests exactly one meeting-filtered page and projects no provider secrets or download authority", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(page()));
    const log = vi.spyOn(console, "log");
    const errorLog = vi.spyOn(console, "error");
    const result = await listRealtimeKitRecordingMetadata(configuration, input, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/realtime/kit/synthetic-app/recordings?meeting_id=${meetingId}&page_no=0&per_page=2&sort_by=invokedTime&sort_order=ASC`,
    );
    expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${configuration.apiToken}`);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected metadata observation");
    expect(realtimeKitRecordingPageSchema.parse(result.value)).toEqual({
      meetingId,
      rows: [
        {
          recordingId,
          sessionId,
          status: "UPLOADED",
          fileBytes: 12345,
          invokedAt: "2026-10-07T12:00:00.000Z",
          startedAt: "2026-10-07T12:00:05.000Z",
          stoppedAt: "2026-10-07T12:30:00.000Z",
        },
      ],
      paging: { startOffset: 1, endOffset: 1, totalCount: 3 },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(JSON.stringify(result)).not.toContain(configuration.apiToken);
    expect(JSON.stringify(result)).not.toContain("download");
    expect(log).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(realtimeKitRecordingStatusSchema.options)(
    "preserves %s without granting owned archive readiness",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(
            page([
              recording({ status, file_size: 0, stopped_time: undefined, download_url: undefined, meeting: undefined }),
            ]),
          ),
        );
      const result = await listRealtimeKitRecordingMetadata(configuration, input, fetcher);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected provider state");
      expect(result.value.rows[0]).toMatchObject({ status, fileBytes: 0 });
      expect(result.value.rows[0]).not.toHaveProperty("stoppedAt");
      expect(result.value.rows[0]).not.toHaveProperty("ready");
    },
  );

  it("keeps an empty page's supplied offsets without inventing a pagination convention", async () => {
    for (const paging of [
      { start_offset: 0, end_offset: 0, total_count: 0 },
      { start_offset: 1, end_offset: 0, total_count: 0 },
      { start_offset: 3, end_offset: 3, total_count: 3 },
      { start_offset: 4, end_offset: 3, total_count: 3 },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(page([], paging)));
      const result = await listRealtimeKitRecordingMetadata(configuration, { ...input, page: 3 }, fetcher);
      expect(result).toEqual({
        ok: true,
        value: {
          meetingId,
          rows: [],
          paging: { startOffset: paging.start_offset, endOffset: paging.end_offset, totalCount: paging.total_count },
        },
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it("refuses a foreign meeting in filtered discovery", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(page([recording({ meeting: { id: foreignId } })])));
    expect(await listRealtimeKitRecordingMetadata(configuration, input, fetcher)).toEqual({
      ok: false,
      error: { kind: "identity_mismatch", status: 200 },
    });
  });

  it.each([
    page([recording(), recording()]),
    page([recording()], { start_offset: 2, end_offset: 1, total_count: 3 }),
    page([recording()], { start_offset: 1, end_offset: 4, total_count: 3 }),
    page([recording()], { start_offset: 0, end_offset: 0, total_count: 0 }),
    page([recording({ file_size: -1 })]),
    page([recording({ file_size: 1.5 })]),
    page([recording({ started_time: undefined })]),
    page([recording({ invoked_time: "not-an-instant" })]),
    page([recording({ status: "READY" })]),
  ])("refuses malformed, duplicate or inconsistent observations without exposing wire data", async (payload) => {
    const result = await listRealtimeKitRecordingMetadata(
      configuration,
      input,
      vi.fn<typeof fetch>().mockResolvedValue(response(payload)),
    );
    expect(result).toEqual({ ok: false, error: { kind: "invalid_response", status: 200 } });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("enforces the requested limit even when provider paging reports more rows", async () => {
    const rows = [recording(), recording({ id: foreignId })];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(page(rows)));
    expect(await listRealtimeKitRecordingMetadata(configuration, { ...input, limit: 1 }, fetcher)).toEqual({
      ok: false,
      error: { kind: "invalid_response", status: 200 },
    });
  });

  it.each(["list", "detail"])("rejects an expanded UTC year through the %s failure envelope", async (operation) => {
    const row = recording({ started_time: "9999-12-31T23:59:00-01:00" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(operation === "list" ? page([row]) : { success: true, data: row }));
    const pending =
      operation === "list"
        ? listRealtimeKitRecordingMetadata(configuration, input, fetcher)
        : getRealtimeKitRecordingMetadata(configuration, expected, fetcher);
    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "invalid_response", status: 200 } });
    expect(JSON.stringify(await pending)).not.toContain(sentinel);
  });

  it("retrieves only the expected recording/session tuple and strips detail-only diagnostics", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true, data: recording() }));
    const result = await getRealtimeKitRecordingMetadata(configuration, expected, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/realtime/kit/synthetic-app/recordings/${recordingId}`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected recording detail");
    expect(realtimeKitRecordingMetadataSchema.parse(result.value)).toMatchObject({ recordingId, sessionId });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result.value).not.toHaveProperty("meetingId");
  });

  it.each([{ id: foreignId }, { session_id: foreignId }, { meeting: { id: foreignId } }])(
    "refuses changed detail identity",
    async (overrides) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true, data: recording(overrides) }));
      expect(await getRealtimeKitRecordingMetadata(configuration, expected, fetcher)).toEqual({
        ok: false,
        error: { kind: "identity_mismatch", status: 200 },
      });
    },
  );

  it("preserves established source ownership when detail omits meeting metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ success: true, data: recording({ meeting: undefined }) }));
    const result = await getRealtimeKitRecordingMetadata(configuration, expected, fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected exact source metadata");
    expect(result.value).toMatchObject({ recordingId, sessionId });
    expect(result.value).not.toHaveProperty("meetingId");
  });

  it.each([null, { ...configuration, apiToken: "" }, { ...configuration, appId: "../foreign" }])(
    "refuses missing or unsafe configuration before any network call",
    async (config) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(await listRealtimeKitRecordingMetadata(config, input, fetcher)).toEqual({
        ok: false,
        error: { kind: "not_configured", status: null },
      });
      expect(await getRealtimeKitRecordingMetadata(config, expected, fetcher)).toEqual({
        ok: false,
        error: { kind: "not_configured", status: null },
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...input, meetingId: sentinel },
    { ...input, page: -1 },
    { ...input, limit: 101 },
  ])("refuses invalid requests before any network call", async (request) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await listRealtimeKitRecordingMetadata(configuration, request, fetcher)).toEqual({
      ok: false,
      error: { kind: "invalid_request", status: null },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "provider_refused"],
    [403, "provider_refused"],
    [404, "not_found"],
    [429, "temporarily_unavailable"],
    [503, "temporarily_unavailable"],
    [302, "provider_refused"],
  ])("classifies HTTP %i and cancels its unread diagnostics", async (status, kind) => {
    const rejected = new Response(sentinel, { status: Number(status) });
    const cancel = vi.spyOn(rejected.body!, "cancel");
    const result = await getRealtimeKitRecordingMetadata(
      configuration,
      expected,
      vi.fn<typeof fetch>().mockResolvedValue(rejected),
    );
    expect(result).toEqual({ ok: false, error: { kind, status } });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it.each([
    new Response("{malformed"),
    new Response(null, { status: 204 }),
    response({ success: false, error: sentinel }),
  ])("refuses malformed success bodies", async (providerResponse) => {
    expect(
      await getRealtimeKitRecordingMetadata(
        configuration,
        expected,
        vi.fn<typeof fetch>().mockResolvedValue(providerResponse),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "invalid_response", status: providerResponse.status },
    });
  });

  it("cancels an oversized success body without retaining it", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel,
    });
    const result = await getRealtimeKitRecordingMetadata(
      configuration,
      expected,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    expect(result).toEqual({ ok: false, error: { kind: "invalid_response", status: 200 } });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("accepts a valid metadata body at the inclusive byte limit", async () => {
    const payload = JSON.stringify({ success: true, data: recording() }).padEnd(1_048_576, " ");
    const providerResponse = new Response(payload);
    const result = await getRealtimeKitRecordingMetadata(
      configuration,
      expected,
      vi.fn<typeof fetch>().mockResolvedValue(providerResponse),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected metadata at the inclusive limit");
    expect(realtimeKitRecordingMetadataSchema.parse(result.value)).toMatchObject({ recordingId, sessionId });
    expect(result.value).not.toHaveProperty("meetingId");
  });

  it("redacts thrown provider diagnostics and cancellation failures", async () => {
    const log = vi.spyOn(console, "error");
    const network = await getRealtimeKitRecordingMetadata(
      configuration,
      expected,
      vi.fn<typeof fetch>().mockRejectedValue(new Error(sentinel)),
    );
    expect(network).toEqual({ ok: false, error: { kind: "temporarily_unavailable", status: null } });
    const rejected = new Response(sentinel, { status: 403 });
    vi.spyOn(rejected.body!, "cancel").mockRejectedValue(new Error(sentinel));
    expect(
      await getRealtimeKitRecordingMetadata(configuration, expected, vi.fn<typeof fetch>().mockResolvedValue(rejected)),
    ).toEqual({
      ok: false,
      error: { kind: "provider_refused", status: 403 },
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["headers", "body", "cancellation"])(
    "bounds stalled %s with the same whole-operation deadline",
    async (stage) => {
      vi.useFakeTimers();
      const observed: { signal?: AbortSignal | null } = {};
      const cancelled = vi.fn();
      const stalled = new ReadableStream<Uint8Array>({ cancel: cancelled });
      const rejected = new Response(sentinel, { status: 403 });
      const bodyCancel = vi
        .spyOn(rejected.body!, "cancel")
        .mockImplementation(() => new Promise<void>(() => undefined));
      const fetcher = vi.fn<typeof fetch>((_url, options) => {
        observed.signal = options?.signal;
        if (stage === "headers")
          return new Promise<Response>((_resolve, reject) => {
            observed.signal?.addEventListener("abort", () => reject(new Error(sentinel)), { once: true });
          });
        return Promise.resolve(stage === "body" ? new Response(stalled) : rejected);
      });
      const pending = getRealtimeKitRecordingMetadata(configuration, expected, fetcher);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(observed.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false, error: { kind: "temporarily_unavailable", status: null } });
      expect(observed.signal?.aborted).toBe(true);
      if (stage === "body") await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
      if (stage === "cancellation") expect(bodyCancel).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("keeps the bounded refusal when an abort-ignoring fetch later returns private metadata", async () => {
    vi.useFakeTimers();
    const late: { resolve?: (value: Response) => void } = {};
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          late.resolve = resolve;
        }),
    );
    const log = vi.spyOn(console, "error");
    const pending = getRealtimeKitRecordingMetadata(configuration, expected, fetcher);
    await vi.advanceTimersByTimeAsync(15_000);
    const refused = await pending;
    expect(refused).toEqual({ ok: false, error: { kind: "temporarily_unavailable", status: null } });
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data: recording() })));
      },
      cancel: cancelled,
    });
    expect(late.resolve).toBeDefined();
    late.resolve?.(new Response(stream));
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(await pending).toEqual(refused);
    expect(JSON.stringify(refused)).not.toContain(sentinel);
    expect(log).not.toHaveBeenCalled();
  });
});
