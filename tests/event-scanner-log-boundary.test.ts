import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import {
  enrolledEventScanResponseSchema,
  eventScanRequestSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { dependencyFailureSchema } from "../assets/shared/schemas/dependency-failure";
import type { Env } from "../functions/_lib/types";

const fixture = createEventScannerFixture();
const malformedQr = "not-a-badge:synthetic-private@example.test";
const providerMarker = "synthetic-provider-sensitive-identifier";

function capturedText(calls: unknown[][]): string {
  return calls
    .map((args) => args.map((value) => (value instanceof Error ? value.message : JSON.stringify(value))).join(" "))
    .join("\n");
}

describe("mounted scanner logging boundary", () => {
  beforeEach(fixture.setup);
  afterEach(() => vi.restoreAllMocks());

  it("does not log recognized, unknown or malformed scanner credentials or operator identifiers", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const unknownBadge = generateBadgeCredential();
    for (const badgeId of [fixture.badgeId, unknownBadge]) {
      const body = eventScanRequestSchema.parse(fixture.scanBody({ badgeId }));
      const response = await fixture.scan(body);
      expect(response.status).toBe(200);
      const result = enrolledEventScanResponseSchema.parse(await response.json());
      if (badgeId === unknownBadge) {
        expect(result).toMatchObject({
          outcome: "unknown",
          reason: "unknown_credential",
          recorded: false,
          attendanceRecorded: false,
        });
      } else {
        expect(result.outcome).not.toBe("unknown");
        expect(result.recorded).toBe(true);
      }
    }
    const valid = eventScanRequestSchema.parse(fixture.scanBody());
    const malformed = await fixture.scan({ ...valid, badgeId: malformedQr });
    expect(malformed.status).toBe(400);
    const text = capturedText([...info.mock.calls, ...errors.mock.calls]);
    for (const forbidden of [
      fixture.badgeId,
      unknownBadge,
      malformedQr,
      fixture.operatorId,
      fixture.userId,
      fixture.token,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("logs only bounded dependency classification when a provider message includes sensitive scanner values", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = `D1_ERROR: Network connection lost. ${providerMarker} ${fixture.badgeId} ${fixture.token}`;
    const DB: Env["DB"] = {
      prepare: () => {
        throw new Error(message);
      },
      batch: async () => {
        throw new Error(message);
      },
    };
    const response = await callApi({ ...env, DB }, "/api/v1/events/scan-test/scans", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fixture.token}` },
      body: JSON.stringify(eventScanRequestSchema.parse(fixture.scanBody())),
    });
    expect(response.status).toBe(503);
    const body = await response.json<{ error: { code: string; details: unknown } }>();
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(dependencyFailureSchema.parse(body.error.details).capability).toBe("data");
    const text = capturedText([...info.mock.calls, ...errors.mock.calls]);
    expect(text).toContain("DEPENDENCY_UNAVAILABLE");
    for (const forbidden of [providerMarker, fixture.badgeId, fixture.token]) {
      expect(text).not.toContain(forbidden);
      expect(JSON.stringify(body)).not.toContain(forbidden);
    }
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
