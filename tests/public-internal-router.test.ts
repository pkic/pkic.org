import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";

function callApp(request: Request): Promise<Response> {
  return Promise.resolve(
    app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any),
  );
}

describe("public and internal router smoke tests", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("serves the public geo endpoint and rejects cross-origin requests", async () => {
    const sameOriginResponse = await callApp(
      new Request("https://app.test/api/v1/geo", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(sameOriginResponse.status).toBe(200);

    const crossOriginResponse = await callApp(
      new Request("https://app.test/api/v1/geo", {
        headers: {
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example.com",
        },
      }),
    );

    expect(crossOriginResponse.status).toBe(403);
  });

  it("serves event terms through the mounted router", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await callApp(new Request("https://app.test/api/v1/events/pqc-2026/terms"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { terms: unknown[] };
    expect(Array.isArray(payload.terms)).toBe(true);
  });

  it("rejects an unsigned internal calendar RSVP request", async () => {
    const response = await callApp(
      new Request("https://app.test/api/v1/internal/calendar/rsvp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "cloudflare_email_route",
          sourceMessageId: "msg-1",
          uid: "x",
          partstat: "DECLINED",
          attendeeEmail: "a@example.test",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("INVALID_SIGNATURE");
  });

  it("serves the MCP Streamable HTTP endpoint", async () => {
    const protectedResource = await callApp(
      new Request("https://app.test/.well-known/oauth-protected-resource/api/v1/mcp"),
    );

    expect(protectedResource.status).toBe(200);
    const protectedPayload = (await protectedResource.json()) as {
      authorization_servers?: string[];
      bearer_methods_supported?: string[];
    };
    expect(protectedPayload.authorization_servers).toContain("https://app.test");
    expect(protectedPayload.bearer_methods_supported).toContain("header");

    const metadata = await callApp(new Request("https://app.test/.well-known/oauth-authorization-server"));
    expect(metadata.status).toBe(200);
    const metadataPayload = (await metadata.json()) as {
      authorization_endpoint?: string;
      token_endpoint?: string;
      registration_endpoint?: string;
    };
    expect(metadataPayload.authorization_endpoint).toBe("https://app.test/api/v1/oauth/authorize");
    expect(metadataPayload.token_endpoint).toBe("https://app.test/api/v1/oauth/token");
    expect(metadataPayload.registration_endpoint).toBe("https://app.test/api/v1/oauth/register");

    const response = await callApp(
      new Request("https://app.test/api/v1/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "vitest", version: "0" },
          },
        }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
