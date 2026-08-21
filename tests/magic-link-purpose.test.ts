import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { requestAdminMagicLink, verifyAdminMagicLink } from "../functions/_lib/auth/admin";
import { requestMemberMagicLink, verifyMemberMagicLink } from "../functions/_lib/auth/member";
import { AUTH_MAGIC_LINK_PURPOSES } from "../functions/_lib/auth/session-engine";
import { sendMcpAuthorizeMagicLink, verifyMcpAuthorizeMagicLink } from "../functions/_lib/mcp/oauth";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
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

async function readMagicLink(token: string): Promise<{ purpose: string | null; used_at: string | null }> {
  const [row] = await queryAll<{ purpose: string | null; used_at: string | null }>(
    env.DB,
    "SELECT purpose, used_at FROM auth_magic_links WHERE token_hash = ?",
    await sha256Hex(token),
  );
  return row;
}

describe("shared auth magic-link purpose isolation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not let member and admin verifiers exchange or consume each other's tokens", async () => {
    await seedDualContextUser();

    const adminMagic = await requestAdminMagicLink(env.DB, {
      email: ADMIN_EMAIL,
      ttlMinutes: 15,
    });
    expect(adminMagic.token).toBeTruthy();
    const adminToken = adminMagic.token!;
    expect(await readMagicLink(adminToken)).toEqual({ purpose: AUTH_MAGIC_LINK_PURPOSES.admin, used_at: null });

    await expect(verifyMemberMagicLink(env.DB, { token: adminToken, sessionTtlHours: 8 })).rejects.toMatchObject({
      code: "MAGIC_LINK_INVALID",
    });
    expect((await readMagicLink(adminToken)).used_at).toBeNull();
    await expect(verifyAdminMagicLink(env.DB, { token: adminToken, sessionTtlHours: 8 })).resolves.toMatchObject({
      admin: { email: ADMIN_EMAIL },
    });

    const memberMagic = await requestMemberMagicLink(env.DB, {
      email: ADMIN_EMAIL,
      ttlMinutes: 15,
    });
    expect(memberMagic.token).toBeTruthy();
    const memberToken = memberMagic.token!;
    expect(await readMagicLink(memberToken)).toEqual({ purpose: AUTH_MAGIC_LINK_PURPOSES.member, used_at: null });

    await expect(verifyAdminMagicLink(env.DB, { token: memberToken, sessionTtlHours: 8 })).rejects.toMatchObject({
      code: "MAGIC_LINK_INVALID",
    });
    expect((await readMagicLink(memberToken)).used_at).toBeNull();
    await expect(verifyMemberMagicLink(env.DB, { token: memberToken, sessionTtlHours: 8 })).resolves.toMatchObject({
      member: { email: ADMIN_EMAIL },
    });
  });

  it("keeps MCP OAuth links out of the normal admin verifier", async () => {
    await seedDualContextUser();
    const returnTo = "/api/v1/oauth/authorize?client_id=purpose-test";

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
    const token = new URL((JSON.parse(outbox.payload_json) as { magicLinkUrl: string }).magicLinkUrl).searchParams.get(
      "token",
    );
    expect(token).toBeTruthy();
    expect(await readMagicLink(token!)).toEqual({ purpose: AUTH_MAGIC_LINK_PURPOSES.mcpOauth, used_at: null });

    await expect(verifyAdminMagicLink(env.DB, { token: token!, sessionTtlHours: 8 })).rejects.toMatchObject({
      code: "MAGIC_LINK_INVALID",
    });
    expect((await readMagicLink(token!)).used_at).toBeNull();

    await expect(
      verifyMcpAuthorizeMagicLink(
        new Request(`https://app.test/api/v1/oauth/verify-link?token=${encodeURIComponent(token!)}`, {
          headers: { "cf-connecting-ip": "203.0.113.90", "user-agent": "purpose-test-browser" },
        }),
        env,
      ),
    ).resolves.toMatchObject({ admin: { email: ADMIN_EMAIL }, returnTo });
  });

  it("fails closed for legacy links with no purpose", async () => {
    const userId = await seedDualContextUser();
    const token = "legacy-purpose-less-token";
    await env.DB.prepare(
      `INSERT INTO auth_magic_links (
         id, user_id, token_hash, purpose, expires_at, used_at, request_ip_hash, user_agent_hash, created_at
       ) VALUES (?, ?, ?, NULL, datetime('now', '+15 minutes'), NULL, NULL, NULL, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, await sha256Hex(token))
      .run();

    await expect(verifyAdminMagicLink(env.DB, { token, sessionTtlHours: 8 })).rejects.toMatchObject({
      code: "MAGIC_LINK_INVALID",
    });
    await expect(verifyMemberMagicLink(env.DB, { token, sessionTtlHours: 8 })).rejects.toMatchObject({
      code: "MAGIC_LINK_INVALID",
    });
    expect((await readMagicLink(token)).used_at).toBeNull();
  });
});
