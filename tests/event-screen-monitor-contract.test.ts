import { describe, expect, it } from "vitest";
import { screenHealthDisplay, screenOwnRunHint } from "../assets/shared/event-screen-health";
import {
  addScreenQualityReading,
  screenNetworkReadings,
  screenQualityReading,
  withScreenQualitySample,
} from "../assets/shared/event-screen-quality";
import {
  SCREEN_MONITOR_LIMITS,
  screenScreenshotFormat,
  screenDeviceMetricsFrom,
  screenDeviceMetricsSchema,
  type ScreenHealth,
  type ScreenMetricValue,
} from "../assets/shared/schemas/event-screen-monitor";

describe("device metrics a screen forwards", () => {
  it("keeps only the allowlisted groups and never a secret", () => {
    const metrics = screenDeviceMetricsFrom({
      uptime: 5400,
      temps: { cpu: 52.5, nvme: 40 },
      network: { ssid: "Venue", wifi_password: "hunter2", interfaces: [{ name: "wlan0", api_key: "x" }] },
      versions: { page: "1.2.0", agent: "0.4.1" },
      management: { secret_sha256: "a".repeat(64) },
    });
    expect(metrics).toEqual({
      uptime: 5400,
      temps: { cpu: 52.5, nvme: 40 },
      network: { ssid: "Venue", interfaces: [{ name: "wlan0" }] },
      versions: { page: "1.2.0", agent: "0.4.1" },
    });
    expect(JSON.stringify(metrics)).not.toMatch(/secret|hunter2|management/);
  });

  it("reads the device agent's own report: uptime in seconds and the network group, nothing else", () => {
    const metrics = screenDeviceMetricsFrom({
      id: "device-1",
      uptime_s: 7260,
      updates: { last_result: "ok" },
      timezone: { zone: "Europe/Amsterdam", source: "network" },
      network: {
        window_s: 300,
        gateway: { loss_pct: 0, samples: 60, avg_ms: 1.4, max_ms: 3.1, p95_ms: 2.2 },
        internet: { loss_pct: 1.7, samples: 60, avg_ms: 18.2, max_ms: 40, p95_ms: 31 },
        wifi: { ssid: "Venue", signal: 72, rate: "270 Mbit/s", channel: "36", bssid: "AA:BB:CC:DD:EE:FF" },
        internet_drops_1h: 0,
        wifi_roams_1h: 1,
        throughput: { iface: "wlan0", rx_bps: 5_200_000, tx_bps: 180_000, interval_s: 5 },
      },
      management: { secret_sha256: "a".repeat(64) },
    });
    expect(metrics?.uptime).toBe(7260);
    expect(Object.keys(metrics!)).toEqual(["uptime", "network"]);
    expect(screenNetworkReadings(metrics)).toEqual({
      internetLatencyMs: 18.2,
      internetLossPercent: 1.7,
      routerLatencyMs: 1.4,
      wifiSignalPercent: 72,
      rxBitsPerSecond: 5_200_000,
      txBitsPerSecond: 180_000,
    });
    expect(screenDeviceMetricsFrom({ uptime_s: 10, network: { throughput: null } })).toEqual({
      uptime: 10,
      network: { throughput: null },
    });
    expect(JSON.stringify(metrics)).not.toMatch(/secret/);
  });

  it("cuts deep, long and oversized reports to the limits, or forwards nothing", () => {
    const deep = screenDeviceMetricsFrom({ network: { a: { b: { c: { d: 1 } } } } });
    expect(deep).toEqual({ network: { a: { b: {} } } });
    const long = screenDeviceMetricsFrom({ versions: { build: "x".repeat(500) } });
    expect((long!.versions as { build: string }).build).toHaveLength(SCREEN_MONITOR_LIMITS.metricsText);
    const huge = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, "y".repeat(120)]));
    expect(screenDeviceMetricsFrom({ network: huge, versions: huge })).toBeNull();
    expect(screenDeviceMetricsFrom("not an object")).toBeNull();
    expect(screenDeviceMetricsFrom({ unknown: 1 })).toBeNull();
  });

  it("refuses a secret-named key a screen did not prune", () => {
    expect(screenDeviceMetricsSchema.safeParse({ network: { token: "t" } }).success).toBe(false);
    expect(screenDeviceMetricsSchema.safeParse({ management: {} }).success).toBe(false);
  });
});

describe("a screen's quality samples", () => {
  const HEALTH: ScreenHealth = {
    pageVersion: "screen-page-test.js",
    kind: "device",
    browser: null,
    display: "output",
    output: "projector",
    mode: "live",
    studioLinkReason: null,
    player: null,
    clockOffsetMs: 0,
    metrics: null,
  };
  const withNetwork = (network: Record<string, ScreenMetricValue>): ScreenHealth => ({
    ...HEALTH,
    metrics: { network },
  });
  const at = Date.parse("2026-11-11T10:15:20.000Z");

  it("reads the device's network group, throughput by any of its names", () => {
    expect(
      screenNetworkReadings({
        network: {
          internet: { avg_ms: 21.4, loss_pct: 1.7 },
          gateway: { avg_ms: 1.2, loss_pct: 0 },
          wifi: { ssid: "Venue", signal: 64 },
          throughput: { rx_bits_per_second: 8_000_000, tx_bps: 250_000 },
        },
      }),
    ).toEqual({
      internetLatencyMs: 21.4,
      internetLossPercent: 1.7,
      routerLatencyMs: 1.2,
      wifiSignalPercent: 64,
      rxBitsPerSecond: 8_000_000,
      txBitsPerSecond: 250_000,
    });
    expect(screenNetworkReadings({ network: { rx: 10, internet: null } })).toMatchObject({
      rxBitsPerSecond: 10,
      internetLatencyMs: null,
    });
    expect(screenNetworkReadings(null).wifiSignalPercent).toBeNull();
  });

  it("folds reports of one minute into its worst, and keeps only the last hour", () => {
    const first = addScreenQualityReading(
      [],
      screenQualityReading(withNetwork({ internet: { avg_ms: 20, loss_pct: 0 }, wifi: { signal: 70 }, rx_bps: 5 })),
      at,
    );
    const second = addScreenQualityReading(
      first.samples,
      screenQualityReading(withNetwork({ internet: { avg_ms: 12, loss_pct: 4 }, wifi: { signal: 50 }, rx_bps: 9 })),
      at + 30_000,
    );
    expect(second.samples).toHaveLength(1);
    expect(second.sample).toEqual({
      minute: "2026-11-11T10:15:00.000Z",
      internetLatencyMs: 20,
      internetLossPercent: 4,
      routerLatencyMs: null,
      wifiSignalPercent: 50,
      rxBitsPerSecond: 9,
      livestreamStalls: null,
    });
    let samples = second.samples;
    for (let minute = 1; minute <= SCREEN_MONITOR_LIMITS.qualityMinutes; minute += 1)
      samples = addScreenQualityReading(samples, screenQualityReading(HEALTH), at + minute * 60_000).samples;
    expect(samples).toHaveLength(SCREEN_MONITOR_LIMITS.qualityMinutes);
    expect(samples[0]!.minute).toBe("2026-11-11T10:16:00.000Z");
    expect(withScreenQualitySample(samples, { ...second.sample, minute: "2026-11-11T11:16:00.000Z" })).toHaveLength(
      SCREEN_MONITOR_LIMITS.qualityMinutes,
    );
  });
});

describe("stalls in the quality samples", () => {
  const livestream = (started: number): ScreenHealth => ({
    pageVersion: "p",
    kind: "device",
    browser: null,
    display: "livestream",
    output: "livestream",
    mode: "live",
    studioLinkReason: null,
    player: {
      status: "playing",
      muted: false,
      changedAt: "2026-11-11T10:00:00.000Z",
      playback: {
        state: "playing",
        // The sliding minute still holds the stall in the next calendar minute; it is not what is counted.
        stalls: { lastMinute: { count: 1, seconds: 2 }, lastHour: { count: 1, seconds: 2 }, started },
        errorCode: null,
        loadedFraction: 1,
        reportedQuality: "auto",
        liveLagSeconds: null,
      },
    },
    clockOffsetMs: 0,
    metrics: null,
  });
  const at = (time: string) => Date.parse(`2026-11-11T${time}.000Z`);

  it("counts each stall once, in the minute of the report that first carried it", () => {
    let samples = addScreenQualityReading([], screenQualityReading(livestream(0)), at("10:00:40")).samples;
    // A stall at 10:00:50, reported at 10:00:55 and still in the sliding minute at 10:01:10.
    samples = addScreenQualityReading(
      samples,
      screenQualityReading(livestream(1), livestream(0)),
      at("10:00:55"),
    ).samples;
    samples = addScreenQualityReading(
      samples,
      screenQualityReading(livestream(1), livestream(1)),
      at("10:01:10"),
    ).samples;
    expect(samples.map((sample) => sample.livestreamStalls)).toEqual([1, 0]);
    // Two more in one minute add up.
    samples = addScreenQualityReading(
      samples,
      screenQualityReading(livestream(3), livestream(1)),
      at("10:01:25"),
    ).samples;
    expect(samples.at(-1)?.livestreamStalls).toBe(2);
    // A reloaded page counts afresh.
    expect(screenQualityReading(livestream(1), livestream(5)).livestreamStalls).toBe(1);
    expect(screenQualityReading({ ...livestream(0), player: null }).livestreamStalls).toBeNull();
  });
});

describe("screenshots a screen sends", () => {
  const WEBP = [0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0];
  it("accepts WebP and JPEG within the limit, read from their bytes, and nothing else", () => {
    expect(screenScreenshotFormat(Uint8Array.from(WEBP))).toBe("webp");
    expect(screenScreenshotFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0]))).toBe("jpeg");
    expect(screenScreenshotFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBeNull();
    expect(
      screenScreenshotFormat(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
    ).toBeNull();
    expect(screenScreenshotFormat(new Uint8Array(0))).toBeNull();
    const large = new Uint8Array(SCREEN_MONITOR_LIMITS.screenshotBytes + 1);
    large.set(WEBP);
    expect(screenScreenshotFormat(large)).toBeNull();
  });
});

describe("health badges", () => {
  it("name only the state, never the output again", () => {
    const base: ScreenHealth = {
      pageVersion: "p",
      kind: "device",
      browser: null,
      display: "livestream",
      output: "livestream",
      mode: "live",
      studioLinkReason: null,
      player: { status: "playing", muted: true, changedAt: "2026-11-11T10:00:00.000Z", playback: null },
      clockOffsetMs: 0,
      metrics: null,
    };
    expect(screenHealthDisplay(base)).toEqual({ label: "Muted", tone: "warn" });
    expect(screenHealthDisplay({ ...base, player: null })).toEqual({ label: "No stream", tone: "warn" });
    expect(
      screenHealthDisplay({ ...base, display: "output", output: "projector", player: null, mode: "offline" }),
    ).toEqual({ label: "Studio link down", tone: "warn" });
    expect(
      screenHealthDisplay({
        ...base,
        display: "output",
        output: "stage-display",
        player: null,
        mode: "offline",
        studioLinkReason: "SOMETHING_NEW",
      }),
    ).toEqual({ label: "Studio link down (SOMETHING_NEW)", tone: "warn" });
    // Its screenshots still change, so staff are told what reaches the screen and what does not.
    expect(screenOwnRunHint(base)).toBeNull();
    expect(screenOwnRunHint({ ...base, mode: "offline", studioLinkReason: "SCREEN_PAGE_OUTDATED" })).toMatchObject({
      stopped: expect.stringContaining("Updates from the studio"),
      next: expect.stringContaining("reloads by itself"),
    });
    expect(screenOwnRunHint({ ...base, mode: "auto" })?.works).toContain("copy of the agenda");
  });
});
