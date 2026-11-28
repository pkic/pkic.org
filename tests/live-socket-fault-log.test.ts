import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { failedLiveSocket } from "../functions/_lib/routes/live-socket-handshake";
import { validationFaultFields } from "../functions/_lib/logging";

const upgrade = new Request("https://pkic.org/api/v1/events/sample/agenda/occurrences/sample/live", {
  headers: { upgrade: "websocket", "cf-ray": "ray-1" },
});

function parseFailure() {
  const schema = z.object({ ticker: z.object({ theme: z.string() }).strict() });
  const result = schema.safeParse({ ticker: { style: "gradient" } });
  if (result.success) throw new Error("expected a failed parse");
  return result.error;
}

afterEach(() => vi.restoreAllMocks());

describe("live socket fault log", () => {
  it("names the fields a parse rejected, without their values", () => {
    expect(validationFaultFields(parseFailure())).toEqual([
      { field: "ticker.theme", code: "invalid_type" },
      { field: "ticker", code: "unrecognized_keys" },
    ]);
    expect(validationFaultFields(new Error("other"))).toBeNull();
  });

  it("logs the rejected fields with the reference the closed socket carries", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failedLiveSocket(upgrade, parseFailure(), "pkic-live.v1");
    expect(response.status).toBe(101);
    const [message, , fields] = log.mock.calls[0]!;
    expect(message).toContain("reference ray-1");
    expect(fields).toContain('"field":"ticker.theme"');
    expect(String(fields)).not.toContain("gradient");
  });
});
