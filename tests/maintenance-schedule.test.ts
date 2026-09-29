import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { maintenanceScheduleSchema, type MaintenanceWindow } from "../assets/shared/schemas/availability";
import { getAvailability } from "../functions/_lib/availability";

const window: MaintenanceWindow = {
  id: "first",
  message: "Database maintenance",
  startsAt: "2026-10-01T10:00:00.000Z",
  endsAt: "2026-10-01T11:00:00.000Z",
  enabled: true,
  policy: "pause",
  channels: ["http"],
};
const at = (time: string) => Date.parse(`2026-10-01T${time}:00.000Z`);
const configured = (windows: MaintenanceWindow[]) => ({
  ...env,
  MAINTENANCE_SCHEDULE: JSON.stringify({ version: 1, windows }),
});

describe("multiple deployment-controlled maintenance windows", () => {
  it("evaluates exact UTC boundaries without querying D1", () => {
    const configuration = configured([window]);
    expect(getAvailability(configuration, at("09:59")).mode).toBe("normal");
    expect(getAvailability(configuration, at("10:00")).mode).toBe("maintenance");
    expect(getAvailability(configuration, at("11:00")).mode).toBe("normal");
    expect(getAvailability(configuration, at("10:30"), "email").mode).toBe("normal");
  });
  it("keeps notices informational and supports cancellation", () => {
    expect(getAvailability(configured([{ ...window, policy: "notice" }]), at("10:30")).mode).toBe("normal");
    expect(getAvailability(configured([{ ...window, enabled: false }]), at("10:30")).windows).toEqual([]);
  });
  it("reports the end of contiguous overlapping restrictions and preserves active messages", () => {
    const configuration = configured([
      window,
      {
        ...window,
        id: "second",
        message: "Second window",
        startsAt: "2026-10-01T10:45:00.000Z",
        endsAt: "2026-10-01T12:00:00.000Z",
      },
    ]);
    expect(getAvailability(configuration, at("10:30")).endsAt).toBe("2026-10-01T12:00:00.000Z");
    expect(getAvailability(configuration, at("10:50")).message).toContain("Second window");
    expect(getAvailability(configuration, at("11:30")).mode).toBe("maintenance");
    expect(getAvailability(configuration, at("12:00")).mode).toBe("normal");
  });
  it("cannot expire emergency mode and fails closed on malformed configuration", () => {
    expect(getAvailability({ ...configured([window]), SERVICE_MODE: "emergency" }, at("12:00")).mode).toBe("emergency");
    expect(getAvailability({ ...env, MAINTENANCE_SCHEDULE: "{" }).mode).toBe("emergency");
    expect(maintenanceScheduleSchema.safeParse({ version: 1, windows: [window, window] }).success).toBe(false);
    expect(
      maintenanceScheduleSchema.safeParse({ version: 1, windows: [{ ...window, endsAt: window.startsAt }] }).success,
    ).toBe(false);
  });
  it("does not announce early restoration when a legacy window overlaps the schedule", () => {
    const configuration = {
      ...configured([window]),
      SERVICE_MODE: "maintenance",
      MAINTENANCE_ENDS_AT: "2026-10-01T10:30:00.000Z",
    };
    expect(getAvailability(configuration, at("10:10")).endsAt).toBe(window.endsAt);
    expect(getAvailability({ ...configuration, MAINTENANCE_ENDS_AT: undefined }, at("10:10")).endsAt).toBeNull();
  });
});
