/**
 * organization-content-review.test.ts
 *
 * workflow half: member content submission ->
 * moderation queue -> staff approve/reject, plus secondary contact
 * nomination -> staff confirmation. The
 * data-bearing columns/admin profile-edit surface these build on were
 * pulled forward in consolidated migration 0035 (see admin-organizations.test.ts); this
 * file covers what's new. Primary and secondary contacts are
 * role-primary_contact/role-secondary_contact grants
 * (user_roles, consolidated migration 0035) — see functions/_lib/services/membership/
 * representative-roles.ts — not columns on `organizations`.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { runScheduledDueWork } from "../functions/_lib/services/scheduled-due-work";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import {
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewsListResponseSchema,
} from "../assets/shared/schemas/organization-content-reviews";
import { organizationContentReviewsListResponseSchema as organizationSelfServiceReviewsListResponseSchema } from "../assets/shared/schemas/organization-self-service";
import {
  drainOrganizationContentReviewNotificationIntents,
  listPendingOrganizationContentReviewNotificationIntents,
  submitOrgContentChange,
} from "../functions/_lib/services/organization-content";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative as addRepresentativeRow,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

class FakeAssetsBucket {
  private readonly objects = new Map<string, ArrayBuffer>();
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

  async delete(key: string): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("temporary staging-logo R2 failure");
    }
    this.objects.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="60" height="60" fill="#175"/></svg>';

function organizationPath(organizationId: string): string {
  return `/api/v1/organizations/${organizationId}`;
}

function organizationContentReviewsPath(organizationId: string): string {
  return `${organizationPath(organizationId)}/content/reviews`;
}

function secondaryContactNominationPath(organizationId: string): string {
  return `${organizationPath(organizationId)}/contacts/secondary/nomination`;
}

function logoUploadRequest(token: string, organizationId: string): Request {
  const formData = new FormData();
  formData.append("file", new File([LOGO_SVG], "organization-logo.svg", { type: "image/svg+xml" }));
  return request(token, `${organizationPath(organizationId)}/logo`, { method: "POST", body: formData });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function seedOrgWithContact(
  email: string,
  category: string,
): Promise<{ organizationId: string; memberId: string; userId: string; identityId: string }> {
  const organizationId = await insertOrganization(env.DB, `Org for ${email}`);
  await env.DB.prepare("UPDATE organizations SET description = 'Old description' WHERE id = ?")
    .bind(organizationId)
    .run();
  const userId = await insertUser(env.DB, email);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  const identityId = await addRepresentativeRow(env.DB, memberId, userId);
  await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  return { organizationId, memberId, userId, identityId };
}

/** Adds another active representative to an org that already has an aggregate. */
async function addRepresentative(organizationId: string, email: string): Promise<string> {
  const userId = await insertUser(env.DB, email);
  const memberRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM members WHERE organization_id = ?", organizationId)
  )[0];
  await addRepresentativeRow(env.DB, memberRow.id, userId);
  return userId;
}

describe("Organization content moderation", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-content-review-token");
  });

  it("lets the primary contact submit a content change, queued as pending — live org row unchanged", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "content-submit-token");

    const response = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "New description", slogan: "New slogan" }),
    });
    expect(response.status).toBe(200);

    const orgRows = await queryAll<{ description: string }>(
      env.DB,
      "SELECT description FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].description).toBe("Old description");

    const reviewRows = await queryAll<{ status: string; organization_id: string }>(
      env.DB,
      "SELECT status, organization_id FROM organization_content_reviews WHERE organization_id = ?",
      organizationId,
    );
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0].status).toBe("pending");

    expect(
      await queryAll<{
        recipient_email: string;
        organization_name: string;
        submitter_name: string;
        queued_outbox_id: string | null;
      }>(
        env.DB,
        `SELECT recipient_email, organization_name, submitter_name, queued_outbox_id
         FROM organization_content_review_notification_intents
         WHERE review_id = (SELECT id FROM organization_content_reviews WHERE organization_id = ?)`,
        organizationId,
      ),
    ).toEqual([
      {
        recipient_email: "admin@pkic.org",
        organization_name: `Org for primary@example.test`,
        submitter_name: "primary@example.test",
        queued_outbox_id: expect.any(String),
      },
    ]);
  });

  it("GET organization content reviews applies the shared list query to D1", async () => {
    const { organizationId, userId } = await seedOrgWithContact("review-list@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "review-list-token");
    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Review-list change" }),
    });
    expect(submitResponse.status).toBe(200);

    const response = await call(
      token,
      organizationContentReviewsPath(organizationId) + "?status=pending&limit=1&sort=status",
    );
    expect(response.status).toBe(200);
    const body = organizationSelfServiceReviewsListResponseSchema.parse(await response.json());
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].status).toBe("pending");
    expect(body.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
  });

  it("binds organization self-service reads and writes to the active membership", async () => {
    const own = await seedOrgWithContact("bound-contact@example.test", "F");
    const other = await seedOrgWithContact("other-contact@example.test", "F");
    const token = await createMemberSession(env.DB, own.userId, "organization-binding-token");

    const ownProfile = await call(token, `${organizationPath(own.organizationId)}/profile`);
    expect(ownProfile.status).toBe(200);
    expect((await ownProfile.json()) as { organization: { id: string } }).toMatchObject({
      organization: { id: own.organizationId },
    });

    expect((await call(token, `${organizationPath(other.organizationId)}/profile`)).status).toBe(404);
    expect((await call(token, organizationContentReviewsPath(other.organizationId))).status).toBe(404);
    const crossOrganizationWrite = await call(token, organizationContentReviewsPath(other.organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "Must not cross organizations" }),
    });
    expect(crossOrganizationWrite.status).toBe(404);
    expect(
      await queryAll(env.DB, "SELECT id FROM organization_content_reviews WHERE organization_id = ?", [
        other.organizationId,
      ]),
    ).toHaveLength(0);
  });

  it("rejects a non-contact representative's submission with 403", async () => {
    const { organizationId } = await seedOrgWithContact("primary2@example.test", "F");
    const nonContactUserId = await addRepresentative(organizationId, "non-contact@example.test");
    const token = await createMemberSession(env.DB, nonContactUserId, "non-contact-content-token");

    const response = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Should fail" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("creates a reviewer intent for a logo-only submission", async () => {
    const { organizationId, userId } = await seedOrgWithContact("logo-only@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "logo-only-token");
    const bucket = new FakeAssetsBucket();

    const response = await app.fetch(
      logoUploadRequest(token, organizationId),
      { ...(env as any), ASSETS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );
    expect(response.status).toBe(200);

    expect(
      await queryAll<{ proposed_changes_json: string; logo_staging_r2_key: string | null; status: string }>(
        env.DB,
        `SELECT proposed_changes_json, logo_staging_r2_key, status
         FROM organization_content_reviews WHERE organization_id = ?`,
        organizationId,
      ),
    ).toEqual([
      {
        proposed_changes_json: "{}",
        logo_staging_r2_key: expect.stringMatching(new RegExp(`^org-logos/${organizationId}/staging-`)),
        status: "pending",
      },
    ]);
    expect(
      await queryAll<{ recipient_email: string }>(
        env.DB,
        `SELECT recipient_email
         FROM organization_content_review_notification_intents
         WHERE review_id = (SELECT id FROM organization_content_reviews WHERE organization_id = ?)`,
        organizationId,
      ),
    ).toEqual([{ recipient_email: "admin@pkic.org" }]);
  });

  it("snapshots only active permitted recipients and immutable review context", async () => {
    const { organizationId, userId } = await seedOrgWithContact("snapshot-submit@example.test", "F");
    const permittedUserId = await insertUser(env.DB, "content-reviewer@example.test");
    const inactiveUserId = await insertUser(env.DB, "inactive-reviewer@example.test");
    const unrelatedUserId = await insertUser(env.DB, "unrelated-reviewer@example.test");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'organizations:content-review', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), permittedUserId, adminId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'organizations:content-review', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), inactiveUserId, adminId),
      env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(inactiveUserId),
    ]);
    const token = await createMemberSession(env.DB, userId, "snapshot-submit-token");
    const response = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "Snapshot this" }),
    });
    expect(response.status).toBe(200);

    const [review] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM organization_content_reviews WHERE organization_id = ?",
      organizationId,
    );
    await env.DB.batch([
      env.DB.prepare("UPDATE organizations SET name = 'Renamed after submission' WHERE id = ?").bind(organizationId),
      env.DB.prepare("UPDATE users SET email = 'changed-after-submission@example.test' WHERE id = ?").bind(userId),
    ]);

    expect(
      await queryAll<{
        recipient_email: string;
        organization_name: string;
        submitter_name: string;
        review_url: string;
      }>(
        env.DB,
        `SELECT recipient_email, organization_name, submitter_name, review_url
         FROM organization_content_review_notification_intents
         WHERE review_id = ? ORDER BY recipient_email`,
        review.id,
      ),
    ).toEqual([
      {
        recipient_email: "admin@pkic.org",
        organization_name: "Org for snapshot-submit@example.test",
        submitter_name: "snapshot-submit@example.test",
        review_url: "https://app.test/portal/#/system/organization-content-reviews",
      },
      {
        recipient_email: "content-reviewer@example.test",
        organization_name: "Org for snapshot-submit@example.test",
        submitter_name: "snapshot-submit@example.test",
        review_url: "https://app.test/portal/#/system/organization-content-reviews",
      },
    ]);
    expect(unrelatedUserId).not.toBe(permittedUserId);
  });

  it("does not duplicate reviewer intents when a logo is attached to a pending content review", async () => {
    const { organizationId, userId } = await seedOrgWithContact("content-then-logo@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "content-then-logo-token");
    expect(
      (
        await call(token, organizationContentReviewsPath(organizationId), {
          method: "POST",
          body: JSON.stringify({ slogan: "Content first" }),
        })
      ).status,
    ).toBe(200);
    const bucket = new FakeAssetsBucket();
    const logoResponse = await app.fetch(
      logoUploadRequest(token, organizationId),
      { ...(env as any), ASSETS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );
    expect(logoResponse.status).toBe(200);
    expect(
      await queryAll<{ count: number }>(
        env.DB,
        `SELECT COUNT(*) AS count
         FROM organization_content_review_notification_intents
         WHERE review_id = (SELECT id FROM organization_content_reviews WHERE organization_id = ?)`,
        organizationId,
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("removes a staged logo when the D1 commit fails after the R2 upload", async () => {
    const { organizationId, userId } = await seedOrgWithContact("staging-logo-rollback@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "staging-logo-rollback-token");
    const bucket = new FakeAssetsBucket();
    await env.DB.prepare(
      `CREATE TRIGGER fail_staging_logo_commit
       BEFORE INSERT ON organization_content_reviews
       WHEN NEW.logo_staging_r2_key IS NOT NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced staging logo D1 failure');
       END`,
    ).run();

    let response: Response;
    try {
      response = await app.fetch(logoUploadRequest(token, organizationId), { ...(env as any), ASSETS_BUCKET: bucket }, {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_staging_logo_commit").run();
    }

    expect(response!.status).toBe(500);
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll<{ logo_staging_r2_key: string | null }>(
        env.DB,
        "SELECT logo_staging_r2_key FROM organizations WHERE id = ?",
        organizationId,
      ),
    ).toEqual([{ logo_staging_r2_key: null }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM organization_content_reviews WHERE organization_id = ?", organizationId),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE bucket = 'assets'")).toEqual(
      [],
    );
  });

  it("retains a failed staged-logo cleanup for durable retry", async () => {
    const { organizationId, userId } = await seedOrgWithContact("staging-logo-retry@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "staging-logo-retry-token");
    const bucket = new FakeAssetsBucket();
    bucket.failuresRemaining = 1;
    await env.DB.prepare(
      `CREATE TRIGGER fail_staging_logo_commit_retry
       BEFORE INSERT ON organization_content_reviews
       WHEN NEW.logo_staging_r2_key IS NOT NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced staging logo D1 failure');
       END`,
    ).run();

    let response: Response;
    try {
      response = await app.fetch(logoUploadRequest(token, organizationId), { ...(env as any), ASSETS_BUCKET: bucket }, {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_staging_logo_commit_retry").run();
    }

    expect(response!.status).toBe(500);
    const [storedKey] = bucket.keys();
    expect(storedKey).toMatch(new RegExp(`^org-logos/${organizationId}/staging-`));
    expect(
      await queryAll<{ bucket: string; object_key: string; status: string }>(
        env.DB,
        "SELECT bucket, object_key, status FROM storage_deletion_outbox WHERE object_key = ?",
        storedKey,
      ),
    ).toEqual([{ bucket: "assets", object_key: storedKey, status: "queued" }]);
    expect(
      await queryAll<{ logo_staging_r2_key: string | null }>(
        env.DB,
        "SELECT logo_staging_r2_key FROM organizations WHERE id = ?",
        organizationId,
      ),
    ).toEqual([{ logo_staging_r2_key: null }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM organization_content_reviews WHERE organization_id = ?", organizationId),
    ).toHaveLength(0);

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now') WHERE object_key = ?")
      .bind(storedKey)
      .run();
    await expect(
      processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM storage_deletion_outbox WHERE object_key = ?", [
        storedKey,
      ]),
    ).toEqual([{ status: "deleted" }]);
  });

  it("rolls back the review when reviewer-intent creation fails", async () => {
    const { organizationId, userId } = await seedOrgWithContact("intent-rollback@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "intent-rollback-token");
    await env.DB.prepare(
      `CREATE TRIGGER fail_content_review_notification_intent
       BEFORE INSERT ON organization_content_review_notification_intents
       BEGIN
         SELECT RAISE(ABORT, 'forced content review notification failure');
       END`,
    ).run();

    try {
      const response = await call(token, organizationContentReviewsPath(organizationId), {
        method: "POST",
        body: JSON.stringify({ description: "Must roll back" }),
      });
      expect(response.status).toBe(500);
      expect(
        await queryAll(env.DB, "SELECT id FROM organization_content_reviews WHERE organization_id = ?", organizationId),
      ).toHaveLength(0);
      expect(
        await queryAll(
          env.DB,
          "SELECT review_id FROM organization_content_review_notification_intents WHERE review_id IN (SELECT id FROM organization_content_reviews)",
        ),
      ).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_content_review_notification_intent").run();
    }
  });

  it("rejects a second submission while one is already pending with 409", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary3@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "double-submit-token");

    await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "First" }),
    });
    const second = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "Second" }),
    });

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REVIEW_ALREADY_PENDING");
  });

  it("enforces one pending review under concurrent submissions", async () => {
    const { organizationId, userId } = await seedOrgWithContact("concurrent-submit@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "concurrent-content-submit-token");

    const responses = await Promise.all([
      call(token, organizationContentReviewsPath(organizationId), {
        method: "POST",
        body: JSON.stringify({ slogan: "First concurrent version" }),
      }),
      call(token, organizationContentReviewsPath(organizationId), {
        method: "POST",
        body: JSON.stringify({ slogan: "Second concurrent version" }),
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending'",
        organizationId,
      ),
    ).toHaveLength(1);
  });

  it("drains reviewer intents exactly once with deterministic outbox identity", async () => {
    const { organizationId, memberId, userId, identityId } = await seedOrgWithContact("intent-drain@example.test", "F");
    await submitOrgContentChange(
      env.DB,
      {
        userId,
        identityId,
        email: "intent-drain@example.test",
        memberId,
        organizationId,
        membershipCategory: "F",
        isEcMember: false,
        activeIdentities: [{ identityId, memberId, organizationId, organizationName: null, membershipCategory: "F" }],
      },
      { slogan: "Queue me" },
      "https://app.test/portal/#/system/organization-content-reviews",
    );
    const [review] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM organization_content_reviews WHERE organization_id = ?",
      organizationId,
    );

    const [existingIntent] = await queryAll<{ queued_outbox_id: string | null }>(
      env.DB,
      "SELECT queued_outbox_id FROM organization_content_review_notification_intents WHERE review_id = ?",
      review.id,
    );
    if (existingIntent?.queued_outbox_id) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM email_outbox WHERE id = ?").bind(existingIntent.queued_outbox_id),
        env.DB.prepare(
          "UPDATE organization_content_review_notification_intents SET queued_outbox_id = NULL, queued_at = NULL WHERE review_id = ?",
        ).bind(review.id),
      ]);
    }

    const pending = await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10);
    expect(pending).toHaveLength(1);
    const first = await drainOrganizationContentReviewNotificationIntents(env.DB, 10);
    expect(first.queued).toBe(1);
    expect(first.outboxIds).toHaveLength(1);
    expect(await drainOrganizationContentReviewNotificationIntents(env.DB, 10)).toEqual({ queued: 0, outboxIds: [] });
    expect(
      await queryAll<{ id: string; idempotency_key: string; recipient_email: string }>(
        env.DB,
        `SELECT id, idempotency_key, recipient_email FROM email_outbox
         WHERE template_key = 'org-content-submitted'`,
      ),
    ).toEqual([
      {
        id: first.outboxIds[0],
        idempotency_key: `organization-content-review-submitted:${review.id}:admin@pkic.org`,
        recipient_email: "admin@pkic.org",
      },
    ]);
    expect(
      await queryAll<{ queued_outbox_id: string | null }>(
        env.DB,
        "SELECT queued_outbox_id FROM organization_content_review_notification_intents WHERE review_id = ?",
        review.id,
      ),
    ).toEqual([{ queued_outbox_id: first.outboxIds[0] }]);
  });

  it("leaves reviewer intents pending when the outbox batch fails, then retries", async () => {
    const { memberId, organizationId, userId, identityId } = await seedOrgWithContact("intent-retry@example.test", "F");
    await submitOrgContentChange(
      env.DB,
      {
        userId,
        identityId,
        email: "intent-retry@example.test",
        memberId,
        organizationId,
        membershipCategory: "F",
        isEcMember: false,
        activeIdentities: [{ identityId, memberId, organizationId, organizationName: null, membershipCategory: "F" }],
      },
      { slogan: "Retry me" },
      "https://app.test/portal/#/system/organization-content-reviews",
    );
    expect(await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10)).toHaveLength(1);
    await env.DB.prepare(
      `CREATE TRIGGER fail_content_review_notification_outbox
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'org-content-submitted'
       BEGIN
         SELECT RAISE(ABORT, 'forced content review outbox failure');
       END`,
    ).run();

    try {
      await expect(drainOrganizationContentReviewNotificationIntents(env.DB, 10)).rejects.toThrow(
        "forced content review outbox failure",
      );
      expect(await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10)).toHaveLength(1);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'org-content-submitted'"),
      ).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_content_review_notification_outbox").run();
    }

    await expect(drainOrganizationContentReviewNotificationIntents(env.DB, 10)).resolves.toMatchObject({ queued: 1 });
  });

  it("rolls back intent marking and converges concurrent drains", async () => {
    const { memberId, organizationId, userId, identityId } = await seedOrgWithContact(
      "intent-mark-race@example.test",
      "F",
    );
    await submitOrgContentChange(
      env.DB,
      {
        userId,
        identityId,
        email: "intent-mark-race@example.test",
        memberId,
        organizationId,
        membershipCategory: "F",
        isEcMember: false,
        activeIdentities: [{ identityId, memberId, organizationId, organizationName: null, membershipCategory: "F" }],
      },
      { slogan: "Mark race" },
      "https://app.test/portal/#/system/organization-content-reviews",
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_content_review_notification_mark
       BEFORE UPDATE ON organization_content_review_notification_intents
       WHEN NEW.queued_outbox_id IS NOT NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced content review notification mark failure');
       END`,
    ).run();

    try {
      await expect(drainOrganizationContentReviewNotificationIntents(env.DB, 10)).rejects.toThrow(
        "forced content review notification mark failure",
      );
      expect(await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10)).toHaveLength(1);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'org-content-submitted'"),
      ).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_content_review_notification_mark").run();
    }

    const results = await Promise.all([
      drainOrganizationContentReviewNotificationIntents(env.DB, 10),
      drainOrganizationContentReviewNotificationIntents(env.DB, 10),
    ]);
    expect(results.reduce((total, result) => total + result.queued, 0)).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'org-content-submitted'"),
    ).toHaveLength(1);
    expect(await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10)).toEqual([]);
  });

  it("skips reviewer draining under a low shared D1 budget and still runs downstream selections", async () => {
    const { memberId, organizationId, userId, identityId } = await seedOrgWithContact("low-budget@example.test", "F");
    await submitOrgContentChange(
      env.DB,
      {
        userId,
        identityId,
        email: "low-budget@example.test",
        memberId,
        organizationId,
        membershipCategory: "F",
        isEcMember: false,
        activeIdentities: [{ identityId, memberId, organizationId, organizationName: null, membershipCategory: "F" }],
      },
      { slogan: "Wait for the next pass" },
      "https://app.test/portal/#/system/organization-content-reviews",
    );
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 6);
    const result = await runScheduledDueWork(
      {
        ...env,
        APP_BASE_URL: "https://app.test",
        SCHEDULED_REMINDER_LIMIT: "0",
        SCHEDULED_OUTBOX_LIMIT: "1",
        SCHEDULED_STORAGE_DELETION_LIMIT: "1",
        SCHEDULED_BADGE_RENDER_LIMIT: "1",
        SCHEDULED_WAITLIST_PROMOTION_LIMIT: "0",
        SCHEDULED_DUE_WORK_MAX_PASSES: "1",
        SCHEDULED_DUE_WORK_MAX_MS: "120000",
      },
      { d1QueryBudget: budgeted.budget },
    );

    expect(result.passes).toHaveLength(1);
    expect(result.stoppedReason).toBe("caught_up");
    expect(budgeted.budget.usedQueries()).toBeLessThanOrEqual(6);
    expect(await listPendingOrganizationContentReviewNotificationIntents(env.DB, 10)).toHaveLength(1);
  });

  it("lets the submitter withdraw a pending review, freeing them to resubmit", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary4@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "withdraw-token");

    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "First" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const withdrawResponse = await call(token, `${organizationContentReviewsPath(organizationId)}/${review.id}`, {
      method: "DELETE",
    });
    expect(withdrawResponse.status).toBe(200);

    const rows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(rows[0].status).toBe("withdrawn");

    const resubmit = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: "Second" }),
    });
    expect(resubmit.status).toBe(200);
  });

  it("staff admin reaches the static content-review collection before dynamic organization IDs, then approves a review", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary5@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "approve-flow-token");
    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Approved description", website: "https://example.test" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const listResponse = await call(
      adminToken,
      "/api/v1/organizations/content-reviews?status=pending&q=primary5&limit=1&sort=organizationName",
    );
    expect(listResponse.status).toBe(200);
    const listBody = organizationContentReviewsListResponseSchema.parse(await listResponse.json());
    expect(listBody.reviews.map((r) => r.id)).toContain(review.id);
    expect(listBody.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });

    const detailResponse = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}`);
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as {
      review: { diff: Array<{ field: string; current: unknown; proposed: unknown }> };
    };
    const descriptionDiff = detailBody.review.diff.find((d) => d.field === "description");
    expect(descriptionDiff?.current).toBe("Old description");
    expect(descriptionDiff?.proposed).toBe("Approved description");

    const approveResponse = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, {
      method: "POST",
    });
    expect(approveResponse.status).toBe(200);
    expect(organizationContentReviewDecisionResponseSchema.parse(await approveResponse.json())).toMatchObject({
      review: { id: review.id, status: "approved", reviewerUserId: adminId },
    });

    const orgRows = await queryAll<{ description: string; website: string }>(
      env.DB,
      "SELECT description, website FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].description).toBe("Approved description");
    expect(orgRows[0].website).toBe("https://example.test");

    const reviewRows = await queryAll<{ status: string; reviewer_user_id: string | null }>(
      env.DB,
      "SELECT status, reviewer_user_id FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(reviewRows[0].status).toBe("approved");
    expect(reviewRows[0].reviewer_user_id).toBe(adminId);
  });

  it("requires an attributable staff identity and removes the legacy API routes", async () => {
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    const organization = await seedOrgWithContact("api-key-review@example.test", "F");
    const memberToken = await createMemberSession(env.DB, organization.userId, "api-key-review-token");
    const submission = await call(memberToken, organizationContentReviewsPath(organization.organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Must require an attributable reviewer" }),
    });
    const submitted = (await submission.json()) as { review: { id: string } };

    const serviceIdentityResponse = await call(
      apiKey,
      `/api/v1/organizations/content-reviews/${submitted.review.id}/approve`,
      { method: "POST" },
    );
    expect(serviceIdentityResponse.status).toBe(403);

    expect((await call(adminToken, "/api/v1/system/organization-content-reviews")).status).toBe(404);

    expect(
      await queryAll<{ status: string; reviewer_user_id: string | null }>(
        env.DB,
        "SELECT status, reviewer_user_id FROM organization_content_reviews WHERE id = ?",
        submitted.review.id,
      ),
    ).toEqual([{ status: "pending", reviewer_user_id: null }]);

    const legacyResponse = await call(
      adminToken,
      `/api/v1/admin/organizations/content-reviews/${submitted.review.id}/approve`,
      { method: "POST" },
    );
    expect(legacyResponse.status).toBe(404);
  });

  it("staff admin can reject a pending review with a reason, leaving the live org row untouched", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary6@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "reject-flow-token");
    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Rejected description" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const rejectResponse = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewerNote: "Too promotional" }),
    });
    expect(rejectResponse.status).toBe(200);
    expect(organizationContentReviewDecisionResponseSchema.parse(await rejectResponse.json())).toMatchObject({
      review: { id: review.id, status: "rejected", reviewerUserId: adminId, reviewerNote: "Too promotional" },
    });

    const orgRows = await queryAll<{ description: string }>(
      env.DB,
      "SELECT description FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].description).toBe("Old description");

    const reviewRows = await queryAll<{ status: string; reviewer_note: string }>(
      env.DB,
      "SELECT status, reviewer_note FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(reviewRows[0].status).toBe("rejected");
    expect(reviewRows[0].reviewer_note).toBe("Too promotional");
  });

  it("rolls back approval state, live content, and email when audit fails", async () => {
    const { organizationId, userId } = await seedOrgWithContact("approve-rollback@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "approve-rollback-token");
    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Must roll back" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };
    await env.DB.prepare(
      `CREATE TRIGGER fail_content_review_approval_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'organization_content_review_approved'
       BEGIN
         SELECT RAISE(ABORT, 'forced content review audit failure');
       END`,
    ).run();

    const response = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, {
      method: "POST",
    });
    expect(response.status).toBe(500);
    expect(
      (
        await queryAll<{ description: string }>(
          env.DB,
          "SELECT description FROM organizations WHERE id = ?",
          organizationId,
        )
      )[0].description,
    ).toBe("Old description");
    expect(
      (
        await queryAll<{ status: string }>(
          env.DB,
          "SELECT status FROM organization_content_reviews WHERE id = ?",
          review.id,
        )
      )[0].status,
    ).toBe("pending");
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", "approve-rollback@example.test"),
    ).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER fail_content_review_approval_audit").run();
  });

  it("allows exactly one concurrent approval or rejection with matching fallout", async () => {
    const { organizationId, userId } = await seedOrgWithContact("decision-race@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "decision-race-token");
    const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: "Race decision" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const responses = await Promise.all([
      call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, { method: "POST" }),
      call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewerNote: "Race rejection" }),
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const [stored] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    const outbox = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE recipient_email = ?",
      "decision-race@example.test",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe(stored.status === "approved" ? "org-content-approved" : "org-content-rejected");
    const audits = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE entity_id IN (?, ?)",
      review.id,
      (
        await queryAll<{ organization_id: string }>(
          env.DB,
          "SELECT organization_id FROM organization_content_reviews WHERE id = ?",
          review.id,
        )
      )[0].organization_id,
    );
    expect(
      audits.filter((row) =>
        ["organization_content_review_approved", "organization_content_review_rejected"].includes(row.action),
      ),
    ).toHaveLength(1);
  });

  it("a non-privileged staff user is rejected from the moderation queue with 403", async () => {
    // A real staff identity whose authority lies entirely elsewhere. That is
    // the caller most likely to slip through: the session is valid and only
    // the permission is wrong.
    const unrelated = await seedPersona(env.DB, "donationsOperator");

    const response = await call(unrelated.token!, "/api/v1/organizations/content-reviews");
    expect(response.status).toBe(403);
  });

  it("allows a non-admin staff identity with the global content-review permission", async () => {
    const reviewer = await seedPersona(env.DB, "organizationContentReviewer");
    const staffToken = reviewer.token!;

    const response = await call(staffToken, "/api/v1/organizations/content-reviews?limit=1");
    expect(response.status).toBe(200);
    expect(organizationContentReviewsListResponseSchema.parse(await response.json()).page).toEqual({
      limit: 1,
      offset: 0,
      total: 0,
      hasMore: false,
    });
  });
});

describe("Secondary contact nomination & confirmation", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-secondary-contact-token");
  });

  it("lets the primary contact nominate a fellow representative, held pending until staff confirms", async () => {
    const { organizationId, memberId, userId: primaryUserId } = await seedOrgWithContact("primary7@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "nominee@example.test");
    const token = await createMemberSession(env.DB, primaryUserId, "nominate-token");

    const nominateResponse = await call(token, secondaryContactNominationPath(organizationId), {
      method: "PUT",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
    expect(nominateResponse.status).toBe(200);

    const nominationRows = await queryAll<{ nominated_user_id: string }>(
      env.DB,
      "SELECT nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
      memberId,
    );
    expect(nominationRows[0].nominated_user_id).toBe(nomineeUserId);

    const secondaryBefore = await queryAll<{ total: number }>(
      env.DB,
      `SELECT COUNT(*) AS total FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = 'role-secondary_contact' AND revoked_at IS NULL`,
      memberId,
    );
    expect(Number(secondaryBefore[0].total)).toBe(0);

    const dispatched: Promise<unknown>[] = [];
    const confirmResponse = await app.fetch(
      request(adminToken, `/api/v1/organizations/${organizationId}/contacts/secondary/confirmation`, {
        method: "POST",
      }),
      env as any,
      {
        passThroughOnException: () => {},
        waitUntil: (promise: Promise<unknown>) => {
          dispatched.push(promise);
          void promise.catch(() => undefined);
        },
      } as any,
    );
    expect(confirmResponse.status).toBe(200);
    expect(await confirmResponse.json()).toEqual({
      organizationId,
      secondaryContactUserId: nomineeUserId,
    });
    expect(dispatched).toHaveLength(1);

    const secondaryAfter = await queryAll<{ user_id: string; granted_by_user_id: string | null }>(
      env.DB,
      `SELECT user_id, granted_by_user_id FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = 'role-secondary_contact' AND revoked_at IS NULL`,
      memberId,
    );
    expect(secondaryAfter[0].user_id).toBe(nomineeUserId);
    expect(secondaryAfter[0].granted_by_user_id).toBe(adminId);

    const nominationAfter = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM organization_secondary_contact_nominations WHERE member_id = ?",
      memberId,
    );
    expect(Number(nominationAfter[0].total)).toBe(0);
  });

  it("rejects API-key confirmation because the canonical organization route requires a user-backed staff actor", async () => {
    const {
      organizationId,
      memberId,
      userId: primaryUserId,
    } = await seedOrgWithContact("api-key-contact-primary@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "api-key-contact-nominee@example.test");
    const token = await createMemberSession(env.DB, primaryUserId, "api-key-contact-nominate-token");
    const nominateResponse = await call(token, secondaryContactNominationPath(organizationId), {
      method: "PUT",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
    expect(nominateResponse.status).toBe(200);

    const confirmResponse = await call(
      env.ADMIN_API_KEY ?? "test-admin-key",
      `/api/v1/organizations/${organizationId}/contacts/secondary/confirmation`,
      { method: "POST" },
    );
    expect(confirmResponse.status).toBe(403);
    expect(
      await queryAll<{ user_id: string; granted_by_user_id: string | null }>(
        env.DB,
        `SELECT user_id, granted_by_user_id FROM user_roles
         WHERE context_type = 'organization' AND context_id = ?
           AND role_id = 'role-secondary_contact' AND revoked_at IS NULL`,
        memberId,
      ),
    ).toEqual([]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'organization_secondary_contact_confirmed'",
      ),
    ).toEqual([]);
  });

  it("rejects confirmation with 409 when there is no pending nomination", async () => {
    const { organizationId } = await seedOrgWithContact("primary8@example.test", "F");
    const response = await call(adminToken, `/api/v1/organizations/${organizationId}/contacts/secondary/confirmation`, {
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  it("rejects a non-primary-contact nomination attempt with 403", async () => {
    const { organizationId } = await seedOrgWithContact("primary9@example.test", "F");
    const nonContactUserId = await addRepresentative(organizationId, "not-primary@example.test");
    const nomineeUserId = await addRepresentative(organizationId, "nominee2@example.test");
    const token = await createMemberSession(env.DB, nonContactUserId, "non-primary-nominate-token");

    const response = await call(token, secondaryContactNominationPath(organizationId), {
      method: "PUT",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects nominating someone who isn't an active representative of the same org with 422", async () => {
    const { organizationId, userId: primaryUserId } = await seedOrgWithContact("primary10@example.test", "F");
    const outsiderUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(outsiderUserId, "outsider@example.test", "outsider@example.test")
      .run();
    const token = await createMemberSession(env.DB, primaryUserId, "outsider-nominate-token");

    const response = await call(token, secondaryContactNominationPath(organizationId), {
      method: "PUT",
      body: JSON.stringify({ userId: outsiderUserId }),
    });
    expect(response.status).toBe(422);
  });

  it("auto-clears a pending nomination when the nominee's identity ends", async () => {
    const { organizationId, memberId, userId: primaryUserId } = await seedOrgWithContact("primary11@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "lapsing-nominee@example.test");
    const token = await createMemberSession(env.DB, primaryUserId, "lapse-token");

    await call(token, secondaryContactNominationPath(organizationId), {
      method: "PUT",
      body: JSON.stringify({ userId: nomineeUserId }),
    });

    const nomineeIdentity = (
      await queryAll<{ id: string }>(
        env.DB,
        `SELECT identity.id
           FROM identities identity
           JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
          WHERE capacity.member_id = ? AND identity.user_id = ?`,
        memberId,
        nomineeUserId,
      )
    )[0];
    const removeResponse = await call(adminToken, `/api/v1/members/capacities/${nomineeIdentity.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const nominationRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM organization_secondary_contact_nominations WHERE member_id = ?",
      memberId,
    );
    expect(Number(nominationRows[0].total)).toBe(0);
  });
});
