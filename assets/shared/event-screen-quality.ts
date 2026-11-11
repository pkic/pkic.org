/**
 * A screen's connection and playback quality over the last hour: what each
 * health report says, folded into one sample a minute. The monitor keeps the
 * samples; staff draw them. The device names its readings; only these are read.
 */
import {
  SCREEN_MONITOR_LIMITS,
  type ScreenDeviceMetrics,
  type ScreenHealth,
  type ScreenMetricValue,
  type ScreenQualitySample,
} from "./schemas/event-screen-monitor";

type Reading = Omit<ScreenQualitySample, "minute">;
const MINUTE_MS = 60_000;

function child(value: ScreenMetricValue | undefined, key: string): ScreenMetricValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined;
}

function reading(value: ScreenMetricValue | undefined, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

/** `rx`, `rx_bps` or `rx_bits_per_second`, on the network group or in one group below it. */
const THROUGHPUT_KEY = /^(rx|tx)(_?bps|_bits_per_second)?$/i;

function throughput(network: ScreenMetricValue | undefined, direction: "rx" | "tx"): number | null {
  if (network === null || typeof network !== "object" || Array.isArray(network)) return null;
  const groups = [network, ...Object.values(network)];
  for (const group of groups) {
    if (group === null || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [key, value] of Object.entries(group)) {
      const match = THROUGHPUT_KEY.exec(key);
      if (match?.[1]?.toLowerCase() === direction && typeof value === "number") return reading(value, 1e12);
    }
  }
  return null;
}

/** The device's network readings, from its `network` metrics group. */
export function screenNetworkReadings(metrics: ScreenDeviceMetrics | null | undefined) {
  const network = metrics?.network;
  const internet = child(network, "internet");
  const gateway = child(network, "gateway");
  return {
    internetLatencyMs: reading(child(internet, "avg_ms"), 60_000),
    internetLossPercent: reading(child(internet, "loss_pct"), 100),
    routerLatencyMs: reading(child(gateway, "avg_ms"), 60_000),
    wifiSignalPercent: reading(child(child(network, "wifi"), "signal"), 100),
    rxBitsPerSecond: throughput(network, "rx"),
    txBitsPerSecond: throughput(network, "tx"),
  };
}

/** What one health report says about quality. */
export function screenQualityReading(health: ScreenHealth): Reading {
  const { txBitsPerSecond: _tx, ...network } = screenNetworkReadings(health.metrics);
  return { ...network, livestreamStalls: health.player?.playback?.stalls.lastMinute.count ?? null };
}

const worst = (a: number | null, b: number | null, pick: (x: number, y: number) => number) =>
  a === null ? b : b === null ? a : pick(a, b);

/** Two reports of one minute: the worst of each, the latest throughput. */
function merge(previous: Reading, next: Reading): Reading {
  return {
    internetLatencyMs: worst(previous.internetLatencyMs, next.internetLatencyMs, Math.max),
    internetLossPercent: worst(previous.internetLossPercent, next.internetLossPercent, Math.max),
    routerLatencyMs: worst(previous.routerLatencyMs, next.routerLatencyMs, Math.max),
    wifiSignalPercent: worst(previous.wifiSignalPercent, next.wifiSignalPercent, Math.min),
    rxBitsPerSecond: next.rxBitsPerSecond ?? previous.rxBitsPerSecond,
    livestreamStalls: worst(previous.livestreamStalls, next.livestreamStalls, Math.max),
  };
}

export function screenQualityMinute(at: number): string {
  return new Date(Math.floor(at / MINUTE_MS) * MINUTE_MS).toISOString();
}

/** The staff copy too: a changed minute replaces its sample; anything older than the hour drops off. */
export function withScreenQualitySample(
  samples: readonly ScreenQualitySample[],
  sample: ScreenQualitySample,
): ScreenQualitySample[] {
  const since = Date.parse(sample.minute) - (SCREEN_MONITOR_LIMITS.qualityMinutes - 1) * MINUTE_MS;
  return [...samples.filter((each) => each.minute !== sample.minute && Date.parse(each.minute) >= since), sample].sort(
    (a, b) => a.minute.localeCompare(b.minute),
  );
}

/** The samples with this report folded into its minute, and that minute's sample. */
export function addScreenQualityReading(
  samples: readonly ScreenQualitySample[],
  next: Reading,
  at: number,
): { samples: ScreenQualitySample[]; sample: ScreenQualitySample } {
  const minute = screenQualityMinute(at);
  const current = samples.find((each) => each.minute === minute);
  const sample = { minute, ...(current ? merge(current, next) : next) };
  return { samples: withScreenQualitySample(samples, sample), sample };
}
