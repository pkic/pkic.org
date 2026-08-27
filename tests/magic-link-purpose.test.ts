import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../assets/shared/constants/email-auth";
import { queueAdminSignInCapability, redeemAdminSignInCapability } from "../functions/_lib/auth/admin";
import { queueMemberSignInCapability, redeemMemberSignInCapability } from "../functions/_lib/auth/member";
import { sendMcpAuthorizeMagicLink, verifyMcpAuthorizeMagicLink } from "../functions/_lib/mcp/oauth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ADMIN_EMAIL = "admin@pkic.org";

async function seedDualContextUser(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE normalized_email = ?",
    ADMIN_EMAIL,
  );
  const organizationId = await insertOrganization(env.DB, "Dual context organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  await addRepresentative(env.DB, memberId, admin.id);
  return admin.id;
}

async function materializeDirectToken(token: string): Promise<string> {
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(
    env.DB,
    env,
    JSON.stringify({ magicLinkUrl: token, __authorizedCapabilityMarkers: [token] }),
  );
  return delivered.magicLinkUrl;
}

describe("stateless email-auth capability purpose isolation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not let member and admin verifiers exchange or consume each other's capabilities", async () => {
    const userId = await seedDualContextUser();
    const adminMagic = await queueAdminSignInCapability(env.DB, {
      email: ADMIN_EMAIL,
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(adminMagic.queuedToken).toMatch(/^pkcq1_/);
    const adminToken = await materializeDirectToken(adminMagic.queuedToken!);
    expect(adminToken).toMatch(/^pkc1_/);

    await expect(
      redeemMemberSignInCapability(env.DB, {
        token: adminToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    await expect(
      redeemAdminSignInCapability(env.DB, {
        token: adminToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).resolves.toMatchObject({ admin: { email: ADMIN_EMAIL } });
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE action = 'admin_magic_link_verified'",
      ),
    ).toHaveLength(1);

    const memberMagic = await queueMemberSignInCapability(env.DB, {
      email: ADMIN_EMAIL,
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(memberMagic.queuedToken).toMatch(/^pkcq1_/);
    const memberToken = await materializeDirectToken(memberMagic.queuedToken!);
    await expect(
      redeemAdminSignInCapability(env.DB, {
        token: memberToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    await expect(
      redeemMemberSignInCapability(env.DB, {
        token: memberToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).resolves.toMatchObject({ member: { email: ADMIN_EMAIL } });
    const [verified] = await queryAll<{ email_verified_at: string | null; email_verification_method: string | null }>(
      env.DB,
      "SELECT email_verified_at, email_verification_method FROM users WHERE id = ?",
      userId,
    );
    expect(verified.email_verified_at).not.toBeNull();
    expect(verified.email_verification_method).toBe("magic_link");
    expect(
      await queryAll(env.DB, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_magic_links'"),
    ).toHaveLength(0);
  });

  it("keeps MCP OAuth capabilities out of the normal admin verifier and records one-time replay in audit", async () => {
    await seedDualContextUser();
    const returnTo = `/api/v1/oauth/authorize?client_id=purpose-test&state=${"x".repeat(1900)}`;

    await sendMcpAuthorizeMagicLink({
      request: new Request("https://app.test/api/v1/oauth/authorize", {
        headers: { "cf-connecting-ip": "203.0.113.90", "user-agent": "purpose-test-browser" },
      }),
      env,
      executionCtx: {} as ExecutionContext,
      email: ADMIN_EMAIL,
      returnTo,
    });

    const [outbox] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'admin_magic_link' ORDER BY created_at DESC LIMIT 1",
    );
    const storedPayload = JSON.parse(outbox.payload_json) as {
      magicLinkUrl: string;
      __authorizedCapabilityMarkers?: unknown[];
    };
    expect(storedPayload.magicLinkUrl).toMatch(/pkcq1_/);
    expect(storedPayload.__authorizedCapabilityMarkers).toHaveLength(1);
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const token = new URL(delivered.magicLinkUrl).searchParams.get("token")!;
    expect(token).toMatch(/^pkc1_/);
    expect(token.length).toBeGreaterThan(512);
    expect(token.length).toBeLessThanOrEqual(EMAIL_AUTH_TOKEN_MAX_LENGTH);

    await expect(
      redeemAdminSignInCapability(env.DB, {
        token,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    await expect(
      verifyMcpAuthorizeMagicLink(
        new Request(`https://app.test/api/v1/oauth/verify-link?token=${encodeURIComponent(token)}`, {
          headers: { "cf-connecting-ip": "203.0.113.90", "user-agent": "purpose-test-browser" },
        }),
        env,
      ),
    ).resolves.toMatchObject({ admin: { email: ADMIN_EMAIL }, returnTo });
    await expect(
      verifyMcpAuthorizeMagicLink(
        new Request(`https://app.test/api/v1/oauth/verify-link?token=${encodeURIComponent(token)}`, {
          headers: { "cf-connecting-ip": "203.0.113.90", "user-agent": "purpose-test-browser" },
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_USED" });
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE action = 'admin_magic_link_verified'",
      ),
    ).toHaveLength(1);
  });
});
