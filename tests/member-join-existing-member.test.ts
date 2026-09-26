import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember, insertOrgRepresentative } from "./helpers/membership";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/auth/capability-links";
import {
  newMemberJoinCapabilityPayload,
  queuedMemberJoinVerificationToken,
} from "../functions/_lib/services/membership/join/capabilities";
import { memberJoinStartResponseSchema, memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";

let testEnv: typeof env;
const address = "returning@member.example";
function post(path: string, body: unknown) {
  return callApi(testEnv, `/api/v1/members/join/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  await resetDb();
  testEnv = {
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  } as typeof env;
});
describe("existing member join guidance", () => {
  it.each(["individual", "organization"] as const)(
    "sends sign-in guidance to an existing %s member without starting an application",
    async (kind) => {
      const member =
        kind === "individual"
          ? await insertIndividualMember(env.DB, "H6", address)
          : await insertOrgRepresentative(env.DB, { email: address });
      const response = await post("start", {
        email: "RETURNING@MEMBER.EXAMPLE",
        unaffiliatedAttestation: kind === "individual",
      });
      expect(response.status).toBe(200);
      expect(memberJoinStartResponseSchema.parse(await response.json())).toEqual({ status: "verification_sent" });
      const emails = await queryAll<{
        template_key: string;
        recipient_email: string;
        recipient_user_id: string;
        payload_json: string;
      }>(env.DB, "SELECT template_key, recipient_email, recipient_user_id, payload_json FROM email_outbox");
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({
        template_key: "membership_join_existing_member",
        recipient_email: address,
        recipient_user_id: member.userId,
      });
      expect(JSON.parse(emails[0].payload_json)).toMatchObject({ loginUrl: expect.stringMatching(/\/portal\/$/) });
      expect(emails[0].payload_json).not.toContain("pkcq1_");
      expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(0);
    },
  );

  it.each([false, true])("only recognizes a secondary address when it is verified (%s)", async (verified) => {
    const member = await insertIndividualMember(env.DB, "H6", "primary@member.example");
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
      .bind(crypto.randomUUID(), member.userId, address, address, verified ? "2026-01-01T00:00:00.000Z" : null)
      .run();
    const response = await post("start", { email: address, unaffiliatedAttestation: true });
    expect(response.status).toBe(200);
    expect(memberJoinStartResponseSchema.parse(await response.json())).toEqual({ status: "verification_sent" });
    expect(await queryAll(env.DB, "SELECT template_key FROM email_outbox")).toEqual([
      { template_key: verified ? "membership_join_existing_member" : "membership_join_verify" },
    ]);
  });

  it.each(["inactive_user", "ended_identity", "inactive_membership"])(
    "does not claim current member access for %s",
    async (state) => {
      const member = await insertIndividualMember(env.DB, "H6", address);
      if (state === "inactive_user")
        await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(member.userId).run();
      if (state === "ended_identity")
        await env.DB.prepare("UPDATE identities SET ended_at = started_at WHERE id = ?").bind(member.identityId).run();
      if (state === "inactive_membership")
        await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(member.memberId).run();
      const response = await post("start", { email: address, unaffiliatedAttestation: true });
      expect(response.status).toBe(200);
      expect(await queryAll(env.DB, "SELECT template_key FROM email_outbox")).toEqual([
        { template_key: "membership_join_verify" },
      ]);
    },
  );

  it("gives previously issued join links sign-in guidance without creating another session", async () => {
    const queued = queuedMemberJoinVerificationToken(newMemberJoinCapabilityPayload(address, "individual"), 900);
    const delivered = await materializeQueuedCapabilityLinks(env.DB, env, {
      token: queued,
      __authorizedCapabilityMarkers: [queued],
    });
    await insertIndividualMember(env.DB, "H6", address);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await post("verify", { token: delivered.token });
      expect(response.status).toBe(200);
      expect(memberJoinVerifyResponseSchema.parse(await response.json())).toEqual({ status: "already_member" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });
});
