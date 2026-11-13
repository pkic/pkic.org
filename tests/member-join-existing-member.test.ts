import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember, insertOrgRepresentative } from "./helpers/membership";
import { joinPath, signInJoinApplicant } from "./helpers/member-join";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";

let testEnv: typeof env;
const address = "returning@member.example";
beforeEach(async () => {
  await resetDb();
  testEnv = {
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  } as typeof env;
});
describe("existing member on the join page", () => {
  it.each(["individual", "organization"] as const)(
    "tells a signed-in %s member they already have access without starting an application",
    async (kind) => {
      if (kind === "individual") await insertIndividualMember(env.DB, "H6", address);
      else await insertOrgRepresentative(env.DB, { email: address });
      const applicant = await signInJoinApplicant(testEnv, address, kind === "individual");
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await joinPath(testEnv, applicant);
        expect(response.status).toBe(200);
        expect(memberJoinVerifyResponseSchema.parse(await response.json())).toEqual({ status: "already_member" });
      }
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(0);
    },
  );

  it("recognizes a membership held through another identity of the same account", async () => {
    const member = await insertOrgRepresentative(env.DB, { email: "work@member.example" });
    await env.DB.prepare("UPDATE users SET email=?, normalized_email=? WHERE id=?")
      .bind(address, address, member.userId)
      .run();
    const response = await joinPath(testEnv, await signInJoinApplicant(testEnv, address, true));
    expect(memberJoinVerifyResponseSchema.parse(await response.json())).toEqual({ status: "already_member" });
  });

  it.each(["ended_identity", "inactive_membership"])("does not claim current member access for %s", async (state) => {
    const member = await insertIndividualMember(env.DB, "H6", address);
    if (state === "ended_identity")
      await env.DB.prepare("UPDATE identities SET ended_at = started_at WHERE id = ?").bind(member.identityId).run();
    if (state === "inactive_membership")
      await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(member.memberId).run();
    const response = await joinPath(testEnv, await signInJoinApplicant(testEnv, address, true));
    expect(response.status).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json()).status).not.toBe("already_member");
  });
});
