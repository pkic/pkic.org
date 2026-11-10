import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import "../functions/http-router";
import { promotionKitSaveSchema } from "../assets/shared/schemas/event-promotion-kit";
import { MCP_PATH } from "../functions/_lib/api-tools/mcp-worker";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { promotionFixture } from "./helpers/promotion-fixture";
import { resetDb } from "./helpers/reset-db";

const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
const { authorize } = createMcpOauthTestClient(env);
const takeaway = "Compare the operational evidence each team needs before approving a cryptographic migration.";

async function agendaRevision(eventId: string) {
  const state = await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
    .bind(eventId)
    .first<{ revision: number }>();
  return state!.revision;
}

/** A refused command costs its own batch plus the separate read that re-proves the MCP grant. */
async function saveStaleCopy(environment: Env, token: string, sessionBase: string, currentRevision: number) {
  const body = promotionKitSaveSchema.parse({
    expectedRevision: currentRevision - 1,
    copy: {
      whyAttend:
        "Explore how independent organizations preserve cryptographic trust while they coordinate migration evidence and operational recovery across certificate owners.",
      takeaways: [takeaway, takeaway, takeaway],
      callToAction: "Register for this event",
      campaign: "synthetic-stale-save",
      approvedAt: new Date().toISOString(),
    },
  });
  return callApi(
    environment,
    MCP_PATH,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "request", arguments: { method: "POST", path: sessionBase, body } },
      }),
    },
    { maxRoundTrips: 2 },
  );
}

async function toolResult(response: Response) {
  const text = await response.text();
  const payload = text.startsWith("event:") ? text.split("data: ")[1]!.split("\n")[0]! : text;
  return (JSON.parse(payload) as { result: { content: Array<{ text: string }> } }).result;
}

describe("MCP refused writes", () => {
  beforeEach(resetDb);

  it("returns the API's refusal instead of a transport failure", async () => {
    const fixture = await promotionFixture();
    const grant = await authorize(undefined, ["agenda:write"]);
    const revision = await agendaRevision(fixture.eventId);

    const response = await saveStaleCopy(env, grant.access_token, fixture.sessionBase, revision);

    expect(response.status).toBe(200);
    expect(JSON.parse((await toolResult(response)).content[0]!.text)).toMatchObject({
      status: 409,
      error: { code: "AGENDA_REVISION_CHANGED" },
    });
    expect(await agendaRevision(fixture.eventId)).toBe(revision);
  });

  it("still challenges the client when authority ended by the time a write was refused", async () => {
    const fixture = await promotionFixture();
    const grant = await authorize(undefined, ["agenda:write"]);
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      async batch(statements) {
        try {
          return await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
            await env.DB.prepare("UPDATE oauth_authorizations SET status='revoked' WHERE id=?")
              .bind(grant.authorizationId)
              .run();
          throw error;
        }
      },
    };

    const response = await saveStaleCopy(
      { ...env, DB: db } as Env,
      grant.access_token,
      fixture.sessionBase,
      await agendaRevision(fixture.eventId),
    );

    expect(response.status, await response.clone().text()).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  });
});
