import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleError } from "../functions/_lib/http";
import { onRequest as organizationLogoRequest } from "../functions/api/v1/organizations/[organizationId]/logo";
import { onRequest as sponsorshipLogoRequest } from "../functions/api/v1/sponsorships/[id]/logo";
import { createAdminSession } from "./helpers/auth";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { validJpegBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";

const JPEG_BYTES = validJpegBytes();

async function callEndpoint(handler: (context: any) => Promise<Response>, context: any): Promise<Response> {
  try {
    return await handler(context);
  } catch (error) {
    return handleError(error);
  }
}

async function setupAdmin(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [{ id }] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
  );
  return createAdminSession(env.DB, id, `admin-logo-token-${crypto.randomUUID()}`);
}

function imageRequest(path: string, token: string, method: "PUT" | "DELETE"): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === "PUT" ? { "content-type": "image/jpeg" } : {}),
    },
    ...(method === "PUT" ? { body: JPEG_BYTES } : {}),
  });
}

async function callLogoRoute(
  handler: (context: any) => Promise<Response>,
  request: Request,
  id: string,
  parameter = "id",
): Promise<Response> {
  const context = createContext(env, request, { [parameter]: id });
  const pending: Promise<unknown>[] = [];
  context.executionCtx.waitUntil = (promise: Promise<unknown>) => {
    pending.push(promise);
  };
  const response = await callEndpoint(handler, context);
  await Promise.all(pending);
  return response;
}

describe("shared organization logo route transport", () => {
  beforeEach(resetDb);

  it("uploads and removes an organization logo through the organization adapter", async () => {
    const token = await setupAdmin();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
       VALUES (?, 'Route Logo Org', 'route logo org', datetime('now'), datetime('now'))`,
    )
      .bind(id)
      .run();

    const putResponse = await callLogoRoute(
      organizationLogoRequest,
      imageRequest(`/api/v1/organizations/${id}/logo`, token, "PUT"),
      id,
      "organizationId",
    );
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as { logoUrl: string; r2Key: string };
    expect(putBody.logoUrl).toBe(`/api/v1/members/${id}/logo`);
    expect(putBody.r2Key).toMatch(new RegExp(`^org-logos/${id}/`));
    expect(await env.ASSETS_BUCKET!.get(putBody.r2Key)).not.toBeNull();
    expect(
      (await queryAll<{ logo_r2_key: string }>(env.DB, "SELECT logo_r2_key FROM organizations WHERE id = ?", id))[0]
        .logo_r2_key,
    ).toBe(putBody.r2Key);

    const deleteResponse = await callLogoRoute(
      organizationLogoRequest,
      imageRequest(`/api/v1/organizations/${id}/logo`, token, "DELETE"),
      id,
      "organizationId",
    );
    expect(deleteResponse.status).toBe(200);
    expect(await env.ASSETS_BUCKET!.get(putBody.r2Key)).toBeNull();
    expect(
      (
        await queryAll<{ logo_r2_key: string | null }>(env.DB, "SELECT logo_r2_key FROM organizations WHERE id = ?", id)
      )[0].logo_r2_key,
    ).toBeNull();
  });

  it("uploads and removes a non-member sponsorship logo through the sponsorship adapter", async () => {
    const token = await setupAdmin();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO sponsorships
         (id, sponsor_type, non_member_name, tier, pipeline_stage, created_at, updated_at)
       VALUES (?, 'consortium', 'Route Sponsor', 'Gold', 'active', datetime('now'), datetime('now'))`,
    )
      .bind(id)
      .run();

    const putResponse = await callLogoRoute(
      sponsorshipLogoRequest,
      imageRequest(`/api/v1/sponsorships/${id}/logo`, token, "PUT"),
      id,
    );
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as { logoUrl: string; r2Key: string };
    expect(putBody.logoUrl).toBe(`/api/v1/sponsors/${id}/logo`);
    expect(putBody.r2Key).toMatch(new RegExp(`^sponsor-logos/${id}/`));
    expect(await env.ASSETS_BUCKET!.get(putBody.r2Key)).not.toBeNull();

    const deleteResponse = await callLogoRoute(
      sponsorshipLogoRequest,
      imageRequest(`/api/v1/sponsorships/${id}/logo`, token, "DELETE"),
      id,
    );
    expect(deleteResponse.status).toBe(200);
    expect(await env.ASSETS_BUCKET!.get(putBody.r2Key)).toBeNull();
    expect(
      (
        await queryAll<{ non_member_logo_r2_key: string | null }>(
          env.DB,
          "SELECT non_member_logo_r2_key FROM sponsorships WHERE id = ?",
          id,
        )
      )[0].non_member_logo_r2_key,
    ).toBeNull();
  });

  it("rejects sponsorship-logo mutation for a member-linked sponsorship", async () => {
    const token = await setupAdmin();
    const organizationId = crypto.randomUUID();
    const sponsorshipId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
         VALUES (?, 'Member Sponsor', 'member sponsor', datetime('now'), datetime('now'))`,
      ).bind(organizationId),
      env.DB.prepare(
        `INSERT INTO sponsorships
             (id, sponsor_type, organization_id, tier, pipeline_stage, created_at, updated_at)
           VALUES (?, 'consortium', ?, 'Gold', 'active', datetime('now'), datetime('now'))`,
      ).bind(sponsorshipId, organizationId),
    ]);

    const response = await callLogoRoute(
      sponsorshipLogoRequest,
      imageRequest(`/api/v1/sponsorships/${sponsorshipId}/logo`, token, "PUT"),
      sponsorshipId,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SPONSORSHIP_IS_ORG_LINKED" } });
  });
});
