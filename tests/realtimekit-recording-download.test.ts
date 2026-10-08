import { afterEach, describe, expect, it, vi } from "vitest";
import { getRealtimeKitRecordingDownload } from "../functions/_lib/services/event-series/realtimekit-recording-download";

const configuration = {
  accountId: "0123456789abcdef0123456789abcdef",
  appId: "synthetic-app",
  apiToken: "synthetic-provider-secret",
};
const recordingId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const meetingId = "10000000-0000-4000-8000-000000000001";
const foreignId = "40000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-07T12:00:00Z");
const sourceUrl = "https://recordings.example.test/private.mp4?signature=private-signature";
const expiresAt = "2026-10-07T12:05:00.000Z";
const expected = { recordingId, sessionId, meetingId, fileBytes: 129 };
const options = { configuredOrigins: ["https://recordings.example.test"], now: () => now };
const sentinel = "PRIVATE_DIAGNOSTICS person@example.test";
function detail(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        id: recordingId,
        session_id: sessionId,
        meeting: { id: meetingId, title: sentinel },
        status: "UPLOADED",
        invoked_time: "2026-10-07T11:00:00Z",
        started_time: "2026-10-07T11:00:05Z",
        stopped_time: "2026-10-07T11:30:00Z",
        file_size: 129,
        download_url: sourceUrl,
        download_url_expiry: expiresAt,
        storage_config: { password: sentinel },
        output_file_name: sentinel,
        ...overrides,
      },
    }),
  );
}
function probe(headers: Record<string, string> = {}, status = 206, bytes = 1) {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { "Content-Range": "bytes 0-0/129", "Content-Length": "1", ETag: '"stable-source"', ...headers },
  });
}
function fetcher(provider = detail(), download = probe()) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(provider).mockResolvedValueOnce(download);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("private RealtimeKit recording download authority", () => {
  it("refreshes only the exact provider detail and probes an approved origin without forwarding the bearer", async () => {
    const request = fetcher(),
      log = vi.spyOn(console, "log"),
      error = vi.spyOn(console, "error");
    expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
      ok: true,
      value: { recordingId, sessionId, fileBytes: 129, sourceUrl, sourceEtag: '"stable-source"', expiresAt },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/realtime/kit/synthetic-app/recordings/${recordingId}`,
    );
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(request.mock.calls[0][1]?.headers).get("Authorization")).toBe(
      `Bearer ${configuration.apiToken}`,
    );
    expect(request.mock.calls[1]).toEqual([
      sourceUrl,
      {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(request.mock.calls[0][1]?.signal).toBe(request.mock.calls[1][1]?.signal);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("gets a fresh signed URL on every step while preserving the stable source ETag", async () => {
    const request = fetcher();
    const renewed = "https://recordings.example.test/private.mp4?signature=renewed";
    request.mockResolvedValueOnce(detail({ download_url: renewed })).mockResolvedValueOnce(probe());
    const first = await getRealtimeKitRecordingDownload(configuration, expected, options, request);
    const second = await getRealtimeKitRecordingDownload(configuration, expected, options, request);
    expect(first).toMatchObject({ ok: true, value: { sourceUrl, sourceEtag: '"stable-source"' } });
    expect(second).toMatchObject({ ok: true, value: { sourceUrl: renewed, sourceEtag: '"stable-source"' } });
    expect(request.mock.calls[2][0]).toBe(request.mock.calls[0][0]);
  });
  it("retains caller ownership context when the provider detail omits meeting data", async () => {
    const result = await getRealtimeKitRecordingDownload(
      configuration,
      expected,
      options,
      fetcher(detail({ meeting: undefined })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected private download");
    expect(result.value).not.toHaveProperty("meetingId");
    expect(result.value).not.toHaveProperty("owned");
  });
  it.each([{ id: foreignId }, { session_id: foreignId }, { meeting: { id: foreignId } }])(
    "refuses foreign provider identity before probing: %s",
    async (overrides) => {
      const request = fetcher(detail(overrides));
      expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
        ok: false,
        error: { kind: "identity_mismatch", status: 200 },
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { status: "UPLOADING" },
    { status: "ERRORED" },
    { file_size: 128 },
    { file_size: 0 },
    { download_url: undefined },
    { download_url_expiry: undefined },
    { download_url_expiry: "not-a-time" },
    { download_url_expiry: "2026-10-07T12:00:00Z" },
    { download_url_expiry: "2026-10-07T12:00:15Z" },
    { download_url_expiry: "9999-12-31T23:59:00-01:00" },
  ])("refuses an unready, changed, missing, expired or malformed download: %s", async (overrides) => {
    const request = fetcher(detail(overrides));
    expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
      ok: false,
      error: { kind: "invalid_response", status: 200 },
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    "http://recordings.example.test/private.mp4",
    "https://foreign.example.test/private.mp4",
    "https://recordings.example.test.evil/private.mp4",
    "https://user:password@recordings.example.test/private.mp4",
    "https://recordings.example.test:443/private.mp4",
    "https://recordings.example.test:444/private.mp4",
    "https://recordings.example.test/private.mp4#fragment",
    "https://recordings.example.test/private.mp4\n",
  ])("refuses unsafe signed location %s before probing", async (download_url) => {
    const request = fetcher(detail({ download_url }));
    expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
      ok: false,
      error: { kind: "invalid_response", status: 200 },
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    { configuredOrigins: [] },
    { configuredOrigins: ["http://recordings.example.test"] },
    { configuredOrigins: ["https://recordings.example.test/path"] },
    { configuredOrigins: ["https://recordings.example.test:443"] },
    { configuredOrigins: ["https://user@recordings.example.test"] },
  ])("refuses an invalid backend origin policy before I/O: $configuredOrigins", async ({ configuredOrigins }) => {
    const request = fetcher();
    expect(
      await getRealtimeKitRecordingDownload(configuration, expected, { ...options, configuredOrigins }, request),
    ).toEqual({ ok: false, error: { kind: "invalid_request", status: null } });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { value: undefined },
    { value: null },
    { value: "https://recordings.example.test" },
    { value: 1 },
    { value: {} },
    { value: ["https://recordings.example.test", null] },
  ])("refuses malformed runtime origin configuration before I/O: $value", async ({ value }) => {
    const request = fetcher();
    const result = await Reflect.apply(getRealtimeKitRecordingDownload, undefined, [
      configuration,
      expected,
      { ...options, configuredOrigins: value },
      request,
    ]);
    expect(result).toEqual({ ok: false, error: { kind: "invalid_request", status: null } });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([0, -1, 15001, 1.5])("refuses a caller deadline outside server policy: %s", async (deadlineMs) => {
    const request = fetcher();
    expect(await getRealtimeKitRecordingDownload(configuration, expected, { ...options, deadlineMs }, request)).toEqual(
      { ok: false, error: { kind: "invalid_request", status: null } },
    );
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [302, {}],
    [200, {}],
    [206, { ETag: 'W/"weak"' }],
    [206, { ETag: "unquoted" }],
    [206, { "Content-Range": "bytes 0-0/130" }],
    [206, { "Content-Range": "bytes 1-1/129" }],
    [206, { "Content-Length": "2" }],
    [206, { "Content-Encoding": "gzip" }],
  ] as const)("refuses probe status or identity headers %s", async (status, headers) => {
    const request = fetcher(detail(), probe(headers, status));
    const result = await getRealtimeKitRecordingDownload(configuration, expected, options, request);
    expect(result).toEqual({ ok: false, error: { kind: "invalid_response", status } });
    expect(JSON.stringify(result)).not.toContain(sourceUrl);
    expect(JSON.stringify(result)).not.toContain(configuration.apiToken);
  });
  it.each([0, 2])("refuses a dishonest one-byte probe body of %s bytes", async (bytes) => {
    expect(
      await getRealtimeKitRecordingDownload(configuration, expected, options, fetcher(detail(), probe({}, 206, bytes))),
    ).toEqual({ ok: false, error: { kind: "invalid_response", status: 206 } });
  });
  it.each(['"s"', '"opaque\\slash"'])("accepts canonical strong opaque ETag %s", async (etag) => {
    const result = await getRealtimeKitRecordingDownload(
      configuration,
      expected,
      options,
      fetcher(detail(), probe({ ETag: etag })),
    );
    expect(result).toMatchObject({ ok: true, value: { sourceEtag: etag } });
  });
  it.each(['"has space"', '"has\u0001control"', '"has\u007fcontrol"', 'W/"weak"'])(
    "refuses whitespace, control or weak probe validator %s",
    async (etag) => {
      const response = probe();
      const readHeader = response.headers.get.bind(response.headers);
      vi.spyOn(response.headers, "get").mockImplementation((name) =>
        name.toLowerCase() === "etag" ? etag : readHeader(name),
      );
      expect(
        await getRealtimeKitRecordingDownload(configuration, expected, options, fetcher(detail(), response)),
      ).toEqual({ ok: false, error: { kind: "invalid_response", status: 206 } });
    },
  );
  it("refuses a response reporting a redirected download even with matching range headers", async () => {
    const response = probe();
    Object.defineProperty(response, "redirected", { value: true });
    expect(
      await getRealtimeKitRecordingDownload(configuration, expected, options, fetcher(detail(), response)),
    ).toEqual({ ok: false, error: { kind: "invalid_response", status: 206 } });
  });
  it("bounds metadata bytes and never probes an oversized provider response", async () => {
    const request = fetcher(new Response(" ".repeat(1048577)));
    expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
      ok: false,
      error: { kind: "invalid_response", status: 200 },
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it("returns bounded provider refusal details without private diagnostics", async () => {
    const request = fetcher(new Response(sentinel, { status: 403 }));
    const result = await getRealtimeKitRecordingDownload(configuration, expected, options, request);
    expect(result).toEqual({ ok: false, error: { kind: "provider_refused", status: 403 } });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(request).toHaveBeenCalledOnce();
  });
  it("redacts thrown private probe URLs and emits no logs", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new Error(`${sourceUrl} ${sentinel}`));
    const log = vi.spyOn(console, "error");
    expect(await getRealtimeKitRecordingDownload(configuration, expected, options, request)).toEqual({
      ok: false,
      error: { kind: "temporarily_unavailable", status: null },
    });
    expect(log).not.toHaveBeenCalled();
  });
  it("uses one cumulative deadline across provider detail and a stalled download probe", async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | null | undefined)[] = [];
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signals.push(init?.signal);
      if (signals.length === 1) return new Promise((resolve) => setTimeout(() => resolve(detail()), 10000));
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error(sentinel)), { once: true }),
      );
    });
    const pending = getRealtimeKitRecordingDownload(configuration, expected, options, request);
    await vi.advanceTimersByTimeAsync(14999);
    expect(request).toHaveBeenCalledTimes(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: { kind: "temporarily_unavailable", status: null } });
    expect(signals[1]?.aborted).toBe(true);
  });
  it("bounds stalled probe-body cancellation and preserves the redacted failure", async () => {
    vi.useFakeTimers();
    const rejected = probe({ "Content-Length": "2" });
    const cancel = vi.spyOn(rejected.body!, "cancel").mockImplementation(() => new Promise(() => undefined));
    const pending = getRealtimeKitRecordingDownload(configuration, expected, options, fetcher(detail(), rejected));
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual({ ok: false, error: { kind: "temporarily_unavailable", status: null } });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
