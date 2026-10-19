import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eventProposalProofVerifyResponseSchema } from "../assets/shared/schemas/event-proposal-proof";
import { signUserSessionToken, USER_SESSION_COOKIE_NAME } from "../functions/_lib/auth/user-session";
import { addHours, nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const post = (path: string, body: unknown, sessionToken: string) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${USER_SESSION_COOKIE_NAME}=${sessionToken}` },
    body: JSON.stringify(body),
  });
const sessionStatus = async (sessionToken: string) =>
  (
    await callApi(env, "/api/v1/auth/session", {
      headers: { cookie: `${USER_SESSION_COOKIE_NAME}=${sessionToken}` },
    })
  ).status;

/** A browser that still carries a cookie the session endpoint refuses, so the page shows the anonymous form. */
async function staleSessions(adminId: string): Promise<Record<string, string>> {
  const removed = await createAdminSession(env.DB, adminId, "removed-session");
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash IS NOT NULL").run();
  await createAdminSession(env.DB, adminId, "idle-staff-session");
  const sessionId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions"))[0].id;
  const now = Math.floor(Date.now() / 1000);
  // Since the portal session change, an idle staff elevation ends the whole session.
  const idle = await signUserSessionToken(env.INTERNAL_SIGNING_SECRET!, {
    sub: adminId,
    sid: sessionId,
    exp: Math.floor(Date.parse(addHours(nowIso(), 8)) / 1000),
    lastActivityAt: now,
    staffLastActivityAt: now - 2 * 60 * 60,
  });
  return { removed, idle };
}

describe("proposal mailbox proof from a browser with an unusable session", () => {
  it("continues as a guest instead of refusing with the session error the page already ignored", async () => {
    const { admin } = await seedEventAndAdmin(env.DB);
    for (const [label, sessionToken] of Object.entries(await staleSessions(admin.id))) {
      expect(await sessionStatus(sessionToken), label).toBe(401);
      const email = `${label}@official.example`;
      const started = await post("/proof", { email, consents }, sessionToken);
      expect(started.status, `${label}: ${await started.clone().text()}`).toBe(200);
      const row = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=?",
          email,
        )
      )[0];
      const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row.payload_json);
      const token = new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify");
      const verified = await post("/proof/verify", { token }, sessionToken);
      expect(verified.status, `${label}: ${await verified.clone().text()}`).toBe(200);
      expect(eventProposalProofVerifyResponseSchema.parse(await verified.json())).toMatchObject({
        status: "ready",
        email,
      });
    }
  });
});
