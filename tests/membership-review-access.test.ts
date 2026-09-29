import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedMemberApplication } from "./helpers/member-applications";
import { materializeQueuedCapabilityLinks, signCapabilityToken } from "../functions/_lib/auth/capability-links";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { memberApplicationStatusResponseSchema } from "../assets/shared/schemas/member-applications";

let adminToken: string;
const originalToken = "original-confirmation-token";
const applicantEmail = "applicant@example.test";

async function call(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(new Request(`https://app.test${path}`, { ...init, headers }), env, createExecutionContext());
}

beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  adminToken = await createAdminSession(env.DB, admin.id, "membership-review-access-token");
});

async function application() {
  return seedMemberApplication({ stage: "processing", manageTokenHash: await sha256Hex(originalToken) });
}

async function stageEmail(id: string) {
  const response = await call(`/api/v1/members/applications/${id}/stage`, adminToken, {
    method: "PATCH",
    body: JSON.stringify({
      toStage: "on_hold",
      onHoldSubtype: "request_information",
      note: "Please clarify your application.",
    }),
  });
  expect(response.status).toBe(200);
  const [row] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'application-hold-information'",
  );
  return JSON.parse(row.payload_json) as Record<string, unknown>;
}

async function status(id: string, token: string) {
  return call(`/api/v1/members/applications/${id}/status?token=${encodeURIComponent(token)}`);
}

describe("application email status links (#83)", () => {
  it("opens the delivered stage email anonymously and preserves the original confirmation link", async () => {
    const id = await application();
    const queued = await stageEmail(id);
    expect(String(queued.statusUrl)).not.toContain(originalToken);
    const delivered = await materializeQueuedCapabilityLinks(env.DB, env, queued);
    const url = new URL(String(delivered.statusUrl));
    expect(url.searchParams.get("id")).toBe(id);
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^pkc1_/);
    for (const credential of [token, originalToken]) {
      const response = await status(id, credential);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(memberApplicationStatusResponseSchema.parse(await response.json()).stage).toBe("on_hold");
    }
    const otherId = await seedMemberApplication({
      organizationDomain: "other.test",
      manageTokenHash: await sha256Hex("other-confirmation-token"),
    });
    expect((await status(otherId, token)).status).toBe(401);
    expect((await status(id, `${token.slice(0, -8)}AAAAAAAA`)).status).toBe(401);
    const detail = await call(`/api/v1/members/applications/${id}?token=${encodeURIComponent(token)}`);
    expect([401, 403]).toContain(detail.status);
  });

  it("rejects expired and wrong-purpose signed links", async () => {
    const id = await application();
    const signing = {
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      linkSecret: `${await sha256Hex(originalToken)}\n${applicantEmail}`,
      resourceId: id,
    };
    const expired = await signCapabilityToken({
      ...signing,
      purpose: "application_status",
      nowSeconds: 1,
      ttlSeconds: 1,
    });
    const wrongPurpose = await signCapabilityToken({ ...signing, purpose: "registration_manage" });
    expect((await status(id, expired)).status).toBe(401);
    expect((await status(id, wrongPurpose)).status).toBe(401);
  });

  it("refuses stale queued and delivered links after the applicant mailbox changes", async () => {
    const id = await application();
    const queued = await stageEmail(id);
    const delivered = await materializeQueuedCapabilityLinks(env.DB, env, queued);
    const token = new URL(String(delivered.statusUrl)).searchParams.get("token")!;
    await env.DB.prepare("UPDATE member_applications SET applicant_email = ? WHERE id = ?")
      .bind("corrected@example.test", id)
      .run();
    expect((await status(id, token)).status).toBe(401);
    await expect(materializeQueuedCapabilityLinks(env.DB, env, queued)).rejects.toMatchObject({
      code: "CAPABILITY_RESOURCE_STALE",
    });
  });
});
