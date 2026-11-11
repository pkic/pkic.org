import { describe, expect, it } from "vitest";
import {
  SCREEN_MONITOR_LIMITS,
  screenDeviceMetricsFrom,
  screenDeviceMetricsSchema,
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
