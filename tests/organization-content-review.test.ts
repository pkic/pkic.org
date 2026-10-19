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
import "./helpers/app";
import { claimPublicationDispatch } from "../functions/_lib/services/site-publication-coordinator";
import { config as publicationConfig } from "./helpers/site-publication-coordinator";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewsListResponseSchema,
} from "../assets/shared/schemas/organization-content-reviews";
import {
  organizationContentReviewCreateResponseSchema,
  organizationContentReviewCreateSchema,
  organizationContentReviewsListResponseSchema as organizationSelfServiceReviewsListResponseSchema,
} from "../assets/shared/schemas/organization-self-service";
import { queueOrganizationContentReviewDigests } from "../functions/_lib/services/organization-content";
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

async function publicationRequests(organizationId: string) {
  return queryAll<{ resource_type: string; resource_id: string; reason_code: string; status: string }>(
    env.DB,
    "SELECT resource_type,resource_id,reason_code,status FROM site_publication_requests WHERE resource_id=?",
    organizationId,
  );
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
    expect(await publicationRequests(organizationId)).toEqual([]);

    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
  });

  it("refuses long-form content carrying a shortcode the page cannot render", async () => {
    const { organizationId, userId } = await seedOrgWithContact("shortcode@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "content-shortcode-token");

    // Issue #12: this used to be stored verbatim and printed with its braces
    // on the public page. The contract refuses it instead, and says so.
    const response = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ contentMarkdown: 'Watch this.\n\n{{< figure src="/x.png" >}}' }),
    });
    expect(response.status).toBe(400);
    const payload = apiErrorPayloadSchema.parse(await response.json());
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(payload.error.details)).toContain("figure");

    // Nothing queued: a refused submission is not a pending review.
    expect(
      await queryAll<{ id: string }>(
        env.DB,
        "SELECT id FROM organization_content_reviews WHERE organization_id = ?",
        organizationId,
      ),
    ).toEqual([]);
  });

  it("accepts long-form content carrying a shortcode the page does render", async () => {
    const { organizationId, userId } = await seedOrgWithContact("shortcode-ok@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "content-shortcode-ok-token");

    const response = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ contentMarkdown: "Our keynote.\n\n{{< youtube HGoZW7MCF60 >}}" }),
    });
    expect(response.status).toBe(200);
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

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "keeps the submitted values in %s profile change history after later edits",
    async (status) => {
      const { organizationId, userId } = await seedOrgWithContact("history@example.test", "F");
      const token = await createMemberSession(env.DB, userId, "review-history-token");
      const path = organizationContentReviewsPath(organizationId);
      const submitted = organizationContentReviewCreateSchema.parse({
        description: "Description sent for review",
        slogan: null,
        links: ["https://example.test/submitted"],
      });
      const submission = await call(token, path, { method: "POST", body: JSON.stringify(submitted) });
      expect(submission.status).toBe(200);
      const { review } = organizationContentReviewCreateResponseSchema.parse(await submission.json());
      const decision =
        status === "withdrawn"
          ? await call(token, `${path}/${review.id}`, { method: "DELETE" })
          : await call(
              adminToken,
              `/api/v1/organizations/content-reviews/${review.id}/${status === "approved" ? "approve" : "reject"}`,
              { method: "POST", body: JSON.stringify({ reviewerNote: "Reviewed submission" }) },
            );
      expect(decision.status, await decision.clone().text()).toBe(200);

      // Later live edits and a new pending submission must not rewrite the older submission.
      await env.DB.prepare("UPDATE organizations SET description = ?, slogan = ?, links_json = ? WHERE id = ?")
        .bind("Current description", "Current slogan", "[]", organizationId)
        .run();
      const pending = await call(token, path, {
        method: "POST",
        body: JSON.stringify({ description: "Next submission", links: [] }),
      });
      expect(pending.status).toBe(200);

      const response = await call(token, path);
      expect(response.status).toBe(200);
      const history = organizationSelfServiceReviewsListResponseSchema.parse(await response.json());
      expect(history.reviews).toHaveLength(1);
      expect(history.reviews[0]).toMatchObject({
        id: review.id,
        organizationId,
        submittedByUserId: userId,
        status,
        proposedChanges: submitted,
      });
      expect(history.reviews[0].proposedChanges).toEqual(submitted);
      expect(history.page.total).toBe(1);
    },
  );

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

  it("keeps a logo-only submission pending without an immediate staff email", async () => {
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
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
  });

  it("keeps content and a later logo in one pending review without immediate emails", async () => {
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
      await queryAll(
        env.DB,
        "SELECT id FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending'",
        organizationId,
      ),
    ).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
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

  async function submitPendingReview(email: string, suffix: string) {
    const record = await seedOrgWithContact(email, "F");
    const token = await createMemberSession(env.DB, record.userId, `digest-${suffix}`);
    const response = await call(token, organizationContentReviewsPath(record.organizationId), {
      method: "POST",
      body: JSON.stringify({ slogan: suffix }),
    });
    expect(response.status).toBe(200);
    const { review } = (await response.json()) as { review: { id: string } };
    return { ...record, token, reviewId: review.id };
  }

  const digestDay = "2026-10-16T12:00:00.000Z";
  const digestRows = () =>
    queryAll<{
      id: string;
      payload_json: string;
      recipient_email: string;
      recipient_user_id: string;
      status: string;
      send_after: string;
    }>(
      env.DB,
      "SELECT id, payload_json, recipient_email, recipient_user_id, status, send_after FROM email_outbox WHERE template_key = 'org-content-review-digest' ORDER BY recipient_email",
    );
  const queueDigests = () => queueOrganizationContentReviewDigests(env.DB, "https://app.test", 100, digestDay);

  it("groups rapid edits and several organizations into one daily overview", async () => {
    const first = await submitPendingReview("digest-first@example.test", "first");
    const second = await submitPendingReview("digest-second@example.test", "second");
    await queueDigests();
    const initial = await digestRows();
    expect(initial).toHaveLength(1);
    expect(initial[0].recipient_user_id).toBe(adminId);
    expect(initial[0].send_after).toBe("2026-10-17T00:00:00.000Z");
    expect(JSON.parse(initial[0].payload_json)).toMatchObject({ pendingCount: 2, reviews: expect.any(Array) });
    // Withdrawing and replacing a review keeps only the current state of that organization.
    expect(
      (
        await call(first.token, `${organizationContentReviewsPath(first.organizationId)}/${first.reviewId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(first.token, organizationContentReviewsPath(first.organizationId), {
          method: "POST",
          body: JSON.stringify({ slogan: "Latest" }),
        })
      ).status,
    ).toBe(200);
    await queueDigests();
    const rows = await digestRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(initial[0].id);
    const payload = JSON.parse(rows[0].payload_json);
    expect(payload.pendingCount).toBe(2);
    expect(payload.reviews).toHaveLength(2);
    expect(payload.reviewUrl).toBe("https://app.test/portal/#/settings/organization-content-reviews");
    expect(JSON.stringify(payload.reviews)).toContain("digest-first@example.test");
    expect(JSON.stringify(payload.reviews)).toContain("digest-second@example.test");
    expect(second.organizationId).not.toBe(first.organizationId);
  });

  it("uses one primary address per active reviewer despite multiple grants and addresses", async () => {
    await submitPendingReview("digest-recipients@example.test", "recipients");
    const permitted = await insertUser(env.DB, "reviewer@example.test");
    const inactive = await insertUser(env.DB, "inactive-reviewer@example.test");
    await insertUser(env.DB, "unrelated@example.test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO permission_grants (id,user_id,permission,granted_by_user_id,created_at) VALUES (?,?,'organizations:content-review',?,?)",
      ).bind(crypto.randomUUID(), permitted, adminId, digestDay),
      env.DB.prepare(
        "INSERT INTO user_roles (id,user_id,role_id,granted_by_user_id,created_at) SELECT ?,?,role_id,?,? FROM role_permissions WHERE permission='organizations:content-review' LIMIT 1",
      ).bind(crypto.randomUUID(), permitted, adminId, digestDay),
      env.DB.prepare(
        "INSERT INTO permission_grants (id,user_id,permission,granted_by_user_id,created_at) VALUES (?,?,'organizations:content-review',?,?)",
      ).bind(crypto.randomUUID(), inactive, adminId, digestDay),
      env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(inactive),
      env.DB.prepare(
        "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,'review-role@example.test','review-role@example.test',?,?)",
      ).bind(crypto.randomUUID(), permitted, digestDay, digestDay),
    ]);
    await queueDigests();
    expect((await digestRows()).map((row) => row.recipient_email)).toEqual(["admin@pkic.org", "reviewer@example.test"]);
  });

  it.each(["permission", "active", "email"])("cancels unsent mail when recipient %s changes", async (change) => {
    await submitPendingReview("digest-recipient-change@example.test", "recipient-change");
    const reviewer = await insertUser(env.DB, "former-reviewer@example.test");
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,granted_by_user_id,created_at) VALUES (?,?,'organizations:content-review',?,?)",
    )
      .bind(crypto.randomUUID(), reviewer, adminId, digestDay)
      .run();
    await queueDigests();
    expect((await digestRows()).find((row) => row.recipient_user_id === reviewer)?.status).toBe("queued");
    if (change === "permission") {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?").bind(digestDay, reviewer).run();
    } else if (change === "active") {
      await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(reviewer).run();
    } else {
      await env.DB.prepare("UPDATE users SET email='new-reviewer@example.test' WHERE id=?").bind(reviewer).run();
    }
    await queueDigests();
    const rows = await digestRows();
    expect(rows.find((row) => row.recipient_user_id === reviewer)?.status).toBe("cancelled");
    expect(rows.find((row) => row.recipient_user_id === adminId)?.status).toBe("queued");
  });

  it.each(["withdraw", "approve", "reject"])(
    "omits a review resolved through %s before dispatch and cancels an empty digest",
    async (action) => {
      const record = await submitPendingReview(`digest-${action}@example.test`, action);
      await queueDigests();
      const response =
        action === "withdraw"
          ? await call(record.token, `${organizationContentReviewsPath(record.organizationId)}/${record.reviewId}`, {
              method: "DELETE",
            })
          : await call(adminToken, `/api/v1/organizations/content-reviews/${record.reviewId}/${action}`, {
              method: "POST",
              body: JSON.stringify(action === "reject" ? { reviewerNote: "Please revise" } : {}),
            });
      expect(response.status).toBe(200);
      const [row] = await digestRows();
      expect(row.status).toBe("cancelled");
      expect(JSON.parse(row.payload_json)).toMatchObject({ pendingCount: 0, reviews: [] });
    },
  );

  it("reuses the same unsent day when the queue empties and refills before midnight", async () => {
    const record = await submitPendingReview("digest-refill@example.test", "refill");
    await queueDigests();
    const [initial] = await digestRows();
    expect(
      (
        await call(record.token, `${organizationContentReviewsPath(record.organizationId)}/${record.reviewId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect((await digestRows())[0].status).toBe("cancelled");
    await submitPendingReview("digest-refilled@example.test", "refilled");
    expect(await queueDigests()).toEqual({ queued: 1 });
    const rows = await digestRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(initial.id);
    expect(rows[0].status).toBe("queued");
    expect(JSON.parse(rows[0].payload_json).pendingCount).toBe(1);
  });

  it("does not create an empty digest and converges concurrent scheduling retries", async () => {
    expect(await queueDigests()).toEqual({ queued: 0 });
    expect(await digestRows()).toHaveLength(0);
    await submitPendingReview("digest-race@example.test", "race");
    const results = await Promise.all([queueDigests(), queueDigests()]);
    expect(results.reduce((n, result) => n + result.queued, 0)).toBe(1);
    expect(await digestRows()).toHaveLength(1);
  });

  it("rolls back digest creation when content refresh fails and retries cleanly", async () => {
    await submitPendingReview("digest-retry@example.test", "retry");
    await env.DB.prepare(`CREATE TRIGGER fail_digest_refresh BEFORE UPDATE ON email_outbox
      WHEN NEW.template_key='org-content-review-digest'
      BEGIN SELECT RAISE(ABORT, 'forced digest refresh failure'); END`).run();
    try {
      await expect(queueDigests()).rejects.toThrow("forced digest refresh failure");
      expect(await digestRows()).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_digest_refresh").run();
    }
    expect(await queueDigests()).toEqual({ queued: 1 });
  });

  it("preserves the pending review while its digest is being delivered", async () => {
    const record = await submitPendingReview("digest-sending@example.test", "sending");
    await queueDigests();
    await env.DB.prepare(
      "UPDATE email_outbox SET status='sending' WHERE template_key='org-content-review-digest'",
    ).run();
    const response = await call(
      record.token,
      `${organizationContentReviewsPath(record.organizationId)}/${record.reviewId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
    expect(
      await queryAll(env.DB, "SELECT status FROM organization_content_reviews WHERE id=?", record.reviewId),
    ).toEqual([{ status: "pending" }]);
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

  it("lists the pending queue oldest first and decided reviews newest first", async () => {
    const reviewIds: string[] = [];
    for (const [index, email] of ["queue-first@example.test", "queue-second@example.test"].entries()) {
      const { organizationId, userId } = await seedOrgWithContact(email, "F");
      const token = await createMemberSession(env.DB, userId, `queue-order-token-${index}`);
      const submitResponse = await call(token, organizationContentReviewsPath(organizationId), {
        method: "POST",
        body: JSON.stringify({ slogan: `Queued ${index}` }),
      });
      expect(submitResponse.status).toBe(200);
      const { review } = (await submitResponse.json()) as { review: { id: string } };
      await env.DB.prepare("UPDATE organization_content_reviews SET submitted_at = ? WHERE id = ?")
        .bind(`2026-01-0${index + 1}T00:00:00.000Z`, review.id)
        .run();
      reviewIds.push(review.id);
    }
    const listedIds = async (status: string) => {
      const response = await call(adminToken, `/api/v1/organizations/content-reviews?status=${status}`);
      expect(response.status).toBe(200);
      return organizationContentReviewsListResponseSchema.parse(await response.json()).reviews.map((r) => r.id);
    };

    expect(await listedIds("pending")).toEqual(reviewIds);
    for (const reviewId of reviewIds) {
      const rejectResponse = await call(adminToken, `/api/v1/organizations/content-reviews/${reviewId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewerNote: "Not this time" }),
      });
      expect(rejectResponse.status, await rejectResponse.clone().text()).toBe(200);
    }
    expect(await listedIds("rejected")).toEqual([...reviewIds].reverse());
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
    expect(await publicationRequests(organizationId)).toEqual([
      {
        resource_type: "organization_content",
        resource_id: organizationId,
        reason_code: "organization_content_approved",
        status: "queued",
      },
    ]);
    const replay = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, {
      method: "POST",
    });
    expect(replay.status).toBe(409);
    expect(await publicationRequests(organizationId)).toHaveLength(1);
    const attempt = await claimPublicationDispatch(env.DB, publicationConfig);
    expect(attempt).toMatchObject({ phase: "dispatching", environment: "production" });
    expect(await publicationRequests(organizationId)).toEqual([
      {
        resource_type: "organization_content",
        resource_id: organizationId,
        reason_code: "organization_content_approved",
        status: "rendering",
      },
    ]);
  });

  it("queues a promoted logo only after its review is approved", async () => {
    const { organizationId, userId } = await seedOrgWithContact("approved-logo@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "approved-logo-token");
    const upload = await app.fetch(
      logoUploadRequest(token, organizationId),
      { ...env, ASSETS_BUCKET: new FakeAssetsBucket() } as any,
      {
        passThroughOnException() {},
        waitUntil() {},
      } as any,
    );
    expect(upload.status).toBe(200);
    expect(await publicationRequests(organizationId)).toEqual([]);
    const [review] = await queryAll<{ id: string; logo_staging_r2_key: string }>(
      env.DB,
      "SELECT id,logo_staging_r2_key FROM organization_content_reviews WHERE organization_id=?",
      organizationId,
    );
    const approval = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, {
      method: "POST",
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    expect(await publicationRequests(organizationId)).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT logo_r2_key FROM organizations WHERE id=?", organizationId)).toEqual([
      { logo_r2_key: review.logo_staging_r2_key },
    ]);
  });

  it.each(["unchanged", "inactive"] as const)("does not request publication for %s approved content", async (mode) => {
    const { organizationId, memberId, userId } = await seedOrgWithContact(`${mode}-publication@example.test`, "F");
    const token = await createMemberSession(env.DB, userId, `${mode}-publication-token`);
    const submission = await call(token, organizationContentReviewsPath(organizationId), {
      method: "POST",
      body: JSON.stringify({ description: mode === "unchanged" ? "Old description" : "Changed private content" }),
    });
    expect(submission.status).toBe(200);
    const { review } = (await submission.json()) as { review: { id: string } };
    if (mode === "inactive")
      await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
    const approval = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}/approve`, {
      method: "POST",
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    expect(await publicationRequests(organizationId)).toEqual([]);
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
    expect(await publicationRequests(organizationId)).toEqual([]);
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
    expect(await publicationRequests(organizationId)).toEqual([]);
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
    expect(await publicationRequests(organizationId)).toHaveLength(stored.status === "approved" ? 1 : 0);
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
      `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
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
