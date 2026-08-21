import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { removeOrganizationLogo, replaceOrganizationLogo } from "../functions/_lib/services/organization-logo";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { onRequestGet as memberLogo } from "../functions/api/v1/members/[id]/logo";
import { createContext } from "./helpers/context";
import type { AuthAdmin } from "../functions/_lib/types";

class FakeAssetsBucket {
  protected readonly objects = new Map<string, ArrayBuffer>();
  failuresRemaining = 0;

  async put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<void> {
    const body =
      typeof value === "string"
        ? new TextEncoder().encode(value).buffer
        : value instanceof ArrayBuffer
          ? value
          : await new Response(value).arrayBuffer();
    this.objects.set(key, body);
  }

  async get(key: string): Promise<{ body: ArrayBuffer; httpMetadata: { contentType: string } } | null> {
    const body = this.objects.get(key);
    return body ? { body, httpMetadata: { contentType: "image/jpeg" } } : null;
  }

  async delete(key: string): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("temporary R2 failure");
    }
    this.objects.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

const jpeg = { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" };

async function setup() {
  await seedEventAndAdmin(env.DB);
  const adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0].id;
  const organizationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
     VALUES (?, 'Logo Org', 'logo org', datetime('now'), datetime('now'))`,
  )
    .bind(organizationId)
    .run();
  const actor: AuthAdmin = { id: adminId, email: "admin@pkic.org", role: "admin" };
  return { actor, organizationId };
}

describe("shared stored-image pointer lifecycle", () => {
  beforeEach(resetDb);

  it("allows one concurrent replacement, cleans the loser, and audits only the winner", async () => {
    const { actor, organizationId } = await setup();
    const bucket = new FakeAssetsBucket();
    const oldKey = `org-logos/${organizationId}/old.jpg`;
    await bucket.put(oldKey, jpeg.buffer);
    await env.DB.prepare("UPDATE organizations SET logo_r2_key = ? WHERE id = ?").bind(oldKey, organizationId).run();

    const replace = () => replaceOrganizationLogo(env.DB, actor, bucket as unknown as R2Bucket, organizationId, jpeg);
    const results = await Promise.allSettled([replace(), replace()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ status: 409, code: "IMAGE_CHANGED" }),
    });

    const pointer = (
      await queryAll<{ logo_r2_key: string }>(env.DB, "SELECT logo_r2_key FROM organizations WHERE id = ?", [
        organizationId,
      ])
    )[0].logo_r2_key;
    expect(bucket.keys()).toEqual([oldKey, pointer].sort());
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'organization_logo_uploaded'")).toHaveLength(
      1,
    );

    await processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10);
    expect(bucket.keys()).toEqual([pointer]);
  });

  it("makes a removed image unreachable before a failed R2 deletion is retried", async () => {
    const { actor, organizationId } = await setup();
    const bucket = new FakeAssetsBucket();
    const oldKey = `org-logos/${organizationId}/old.jpg`;
    await bucket.put(oldKey, jpeg.buffer);
    await env.DB.prepare("UPDATE organizations SET logo_r2_key = ? WHERE id = ?").bind(oldKey, organizationId).run();
    await removeOrganizationLogo(env.DB, actor, organizationId);

    bucket.failuresRemaining = 1;
    await processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10);
    expect(bucket.keys()).toContain(oldKey);
    await expect(
      memberLogo(
        createContext(
          { ...(env as any), ASSETS_BUCKET: bucket },
          new Request(`https://app.test/api/v1/members/${organizationId}/logo`),
          { id: organizationId },
        ),
      ),
    ).rejects.toMatchObject({ status: 404, code: "LOGO_NOT_FOUND" });

    await env.DB.prepare(
      "UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now', '-1 second') WHERE object_key = ?",
    )
      .bind(oldKey)
      .run();
    await processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10);
    expect(bucket.keys()).not.toContain(oldKey);
  });
});
