/**
 * A screen's last hour at a glance: one row per reading with its trend and
 * its latest value. Every screen shows internet latency and loss; a
 * livestream screen adds throughput and stalls.
 */
import { formatTimeOfDay } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  SCREEN_MONITOR_LIMITS,
  type ScreenQualitySample,
} from "../../../../../../../shared/schemas/event-screen-monitor";
import { Sparkline } from "../../../../../../ui/Sparkline";
import "./ScreenQualityTrend.css";

const MINUTE_MS = 60_000;

type Reading = Exclude<keyof ScreenQualitySample, "minute">;

const READINGS: Record<
  "latency" | "loss" | "throughput" | "stalls",
  {
    key: Reading;
    label: string;
    format: (value: number) => string;
    variant?: "bars";
    color?: string;
    max?: number;
  }
> = {
  latency: { key: "internetLatencyMs", label: "Latency", format: (v) => `${formatNumber(Math.round(v))} ms`, max: 50 },
  loss: {
    key: "internetLossPercent",
    label: "Loss",
    format: (v) => `${formatNumber(Math.round(v * 10) / 10)} %`,
    variant: "bars",
    color: "var(--pk-warn)",
    max: 5,
  },
  throughput: {
    key: "rxBitsPerSecond",
    label: "Throughput",
    format: (v) => `${formatNumber(Math.round(v / 100_000) / 10)} Mbit/s`,
  },
  stalls: {
    key: "livestreamStalls",
    label: "Stalls",
    format: (v) => formatNumber(v),
    variant: "bars",
    color: "var(--pk-risk)",
    max: 3,
  },
};

/** One value per minute of the last hour, oldest first; null where no report came. */
function minutes(samples: readonly ScreenQualitySample[], now: number) {
  const byMinute = new Map(samples.map((sample) => [Date.parse(sample.minute), sample]));
  const last = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  return Array.from({ length: SCREEN_MONITOR_LIMITS.qualityMinutes }, (_, index) => {
    const at = last - (SCREEN_MONITOR_LIMITS.qualityMinutes - 1 - index) * MINUTE_MS;
    return { at, sample: byMinute.get(at) ?? null };
  });
}

export function ScreenQualityTrend({
  screenName,
  samples,
  livestream,
  now,
  compact = false,
}: {
  screenName: string;
  samples: readonly ScreenQualitySample[];
  livestream: boolean;
  now: number;
  /** The studio's panel: latency and loss only, or stalls for a livestream. */
  compact?: boolean;
}) {
  const hour = minutes(samples, now);
  const labels = hour.map(({ at }) => formatTimeOfDay(new Date(at).toISOString()));
  const shown = compact
    ? [READINGS.latency, livestream ? READINGS.stalls : READINGS.loss]
    : [READINGS.latency, READINGS.loss, ...(livestream ? [READINGS.throughput, READINGS.stalls] : [])];
  // A reading with nothing in the hour draws no row; a screen with no readings, no list.
  const rows = shown.flatMap((reading) => {
    const values = hour.map(({ sample }) => sample?.[reading.key] ?? null);
    return values.some((value) => value !== null) ? [{ reading, values }] : [];
  });
  if (!rows.length) return null;
  return (
    <dl class="pk-screen-quality" data-compact={compact || undefined}>
      {rows.map(({ reading, values }) => {
        const latest = [...values].reverse().find((value) => value !== null) ?? null;
        return (
          <div key={reading.key} class="pk-screen-quality__row">
            <dt class="pk-screen-quality__label">{reading.label}</dt>
            <dd class="pk-screen-quality__trend">
              <Sparkline
                values={values}
                labels={labels}
                caption={`${screenName}: ${reading.label.toLowerCase()}, last hour`}
                valueHeader={reading.label}
                format={reading.format}
                variant={reading.variant}
                color={reading.color}
                max={reading.max}
              />
            </dd>
            <dd class="pk-screen-quality__value">{latest === null ? "" : reading.format(latest)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
