/**
 * organization-content-review.test.ts
 *
 * PRD §4.11's workflow half (Phase 4C): member content submission ->
 * moderation queue -> staff approve/reject, plus secondary contact
 * nomination -> staff confirmation. The data-bearing columns/admin
 * profile-edit surface these build on were pulled forward in Phase 4A (see
 * admin-organizations.test.ts); this file covers what's new in Phase 4C.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(request(token, path, init), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

async function seedOrgWithContact(
  email: string,
  category: string,
): Promise<{ organizationId: string; userId: string }> {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, membership_category, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Old description', datetime('now'), datetime('now'))`,
  )
    .bind(organizationId, `Org for ${email}`, `org for ${email}`, category)
    .run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    ).bind(memberId, category, userId, organizationId),
  ]);
  await env.DB.prepare("UPDATE organizations SET primary_contact_user_id = ? WHERE id = ?")
    .bind(userId, organizationId)
    .run();

  return { organizationId, userId };
}

async function addRepresentative(organizationId: string, email: string, category: string): Promise<string> {
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    ).bind(memberId, category, userId, organizationId),
  ]);
  return userId;
}

describe("Organization content moderation (PRD §4.11, Phase 4C)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-content-review-token");
  });

  it("lets the primary contact submit a content change, queued as pending — live org row unchanged", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "content-submit-token");

    const response = await call(token, "/api/v1/me/organization", {
      method: "PATCH",
      body: JSON.stringify({ description: "New description", slogan: "New slogan" }),
    });
    expect(response.status).toBe(200);

    const orgRows = await queryAll<{ description: string }>(env.DB, "SELECT description FROM organizations WHERE id = ?", organizationId);
    expect(orgRows[0].description).toBe("Old description");

    const reviewRows = await queryAll<{ status: string; organization_id: string }>(
      env.DB,
      "SELECT status, organization_id FROM organization_content_reviews WHERE organization_id = ?",
      organizationId,
    );
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0].status).toBe("pending");
  });

  it("rejects a non-contact representative's submission with 403", async () => {
    const { organizationId } = await seedOrgWithContact("primary2@example.test", "F");
    const nonContactUserId = await addRepresentative(organizationId, "non-contact@example.test", "F");
    const token = await createMemberSession(env.DB, nonContactUserId, "non-contact-content-token");

    const response = await call(token, "/api/v1/me/organization", {
      method: "PATCH",
      body: JSON.stringify({ description: "Should fail" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("rejects a second submission while one is already pending with 409", async () => {
    const { userId } = await seedOrgWithContact("primary3@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "double-submit-token");

    await call(token, "/api/v1/me/organization", { method: "PATCH", body: JSON.stringify({ slogan: "First" }) });
    const second = await call(token, "/api/v1/me/organization", { method: "PATCH", body: JSON.stringify({ slogan: "Second" }) });

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REVIEW_ALREADY_PENDING");
  });

  it("lets the submitter withdraw a pending review, freeing them to resubmit", async () => {
    const { userId } = await seedOrgWithContact("primary4@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "withdraw-token");

    const submitResponse = await call(token, "/api/v1/me/organization", { method: "PATCH", body: JSON.stringify({ slogan: "First" }) });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const withdrawResponse = await call(token, `/api/v1/me/organization/reviews/${review.id}`, { method: "DELETE" });
    expect(withdrawResponse.status).toBe(200);

    const rows = await queryAll<{ status: string }>(env.DB, "SELECT status FROM organization_content_reviews WHERE id = ?", review.id);
    expect(rows[0].status).toBe("withdrawn");

    const resubmit = await call(token, "/api/v1/me/organization", { method: "PATCH", body: JSON.stringify({ slogan: "Second" }) });
    expect(resubmit.status).toBe(200);
  });

  it("staff admin can list, approve, and apply a pending review", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary5@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "approve-flow-token");
    const submitResponse = await call(token, "/api/v1/me/organization", {
      method: "PATCH",
      body: JSON.stringify({ description: "Approved description", website: "https://example.test" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const listResponse = await call(adminToken, "/api/v1/admin/organizations/content-reviews");
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { reviews: Array<{ id: string }> };
    expect(listBody.reviews.map((r) => r.id)).toContain(review.id);

    const detailResponse = await call(adminToken, `/api/v1/admin/organizations/content-reviews/${review.id}`);
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as { review: { diff: Array<{ field: string; current: unknown; proposed: unknown }> } };
    const descriptionDiff = detailBody.review.diff.find((d) => d.field === "description");
    expect(descriptionDiff?.current).toBe("Old description");
    expect(descriptionDiff?.proposed).toBe("Approved description");

    const approveResponse = await call(adminToken, `/api/v1/admin/organizations/content-reviews/${review.id}/approve`, { method: "POST" });
    expect(approveResponse.status).toBe(200);

    const orgRows = await queryAll<{ description: string; website: string }>(
      env.DB,
      "SELECT description, website FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].description).toBe("Approved description");
    expect(orgRows[0].website).toBe("https://example.test");

    const reviewRows = await queryAll<{ status: string; reviewer_user_id: string }>(
      env.DB,
      "SELECT status, reviewer_user_id FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(reviewRows[0].status).toBe("approved");
    expect(reviewRows[0].reviewer_user_id).toBeTruthy();
  });

  it("staff admin can reject a pending review with a reason, leaving the live org row untouched", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary6@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "reject-flow-token");
    const submitResponse = await call(token, "/api/v1/me/organization", {
      method: "PATCH",
      body: JSON.stringify({ description: "Rejected description" }),
    });
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    const rejectResponse = await call(adminToken, `/api/v1/admin/organizations/content-reviews/${review.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewerNote: "Too promotional" }),
    });
    expect(rejectResponse.status).toBe(200);

    const orgRows = await queryAll<{ description: string }>(env.DB, "SELECT description FROM organizations WHERE id = ?", organizationId);
    expect(orgRows[0].description).toBe("Old description");

    const reviewRows = await queryAll<{ status: string; reviewer_note: string }>(
      env.DB,
      "SELECT status, reviewer_note FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(reviewRows[0].status).toBe("rejected");
    expect(reviewRows[0].reviewer_note).toBe("Too promotional");
  });

  it("a non-privileged staff user is rejected from the moderation queue with 403", async () => {
    const staffUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffUserId, "staff@example.test", "staff@example.test")
      .run();
    // Baseline unrelated grant so this actor is eligible for a staff session at all.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, staffUserId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "unprivileged-staff-token");

    const response = await call(staffToken, "/api/v1/admin/organizations/content-reviews");
    expect(response.status).toBe(403);
  });
});

describe("Secondary contact nomination & confirmation (PRD §4.11, Phase 4C)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-secondary-contact-token");
  });

  it("lets the primary contact nominate a fellow representative, held pending until staff confirms", async () => {
    const { organizationId, userId: primaryUserId } = await seedOrgWithContact("primary7@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "nominee@example.test", "F");
    const token = await createMemberSession(env.DB, primaryUserId, "nominate-token");

    const nominateResponse = await call(token, "/api/v1/me/organization/secondary-contact", {
      method: "PATCH",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
    expect(nominateResponse.status).toBe(200);

    const orgRows = await queryAll<{ pending_secondary_contact_user_id: string | null; secondary_contact_user_id: string | null }>(
      env.DB,
      "SELECT pending_secondary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].pending_secondary_contact_user_id).toBe(nomineeUserId);
    expect(orgRows[0].secondary_contact_user_id).toBeNull();

    const confirmResponse = await call(adminToken, `/api/v1/admin/organizations/${organizationId}/confirm-secondary-contact`, {
      method: "POST",
    });
    expect(confirmResponse.status).toBe(200);

    const confirmedRows = await queryAll<{ pending_secondary_contact_user_id: string | null; secondary_contact_user_id: string | null }>(
      env.DB,
      "SELECT pending_secondary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(confirmedRows[0].secondary_contact_user_id).toBe(nomineeUserId);
    expect(confirmedRows[0].pending_secondary_contact_user_id).toBeNull();
  });

  it("rejects confirmation with 409 when there is no pending nomination", async () => {
    const { organizationId } = await seedOrgWithContact("primary8@example.test", "F");
    const response = await call(adminToken, `/api/v1/admin/organizations/${organizationId}/confirm-secondary-contact`, {
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  it("rejects a non-primary-contact nomination attempt with 403", async () => {
    const { organizationId } = await seedOrgWithContact("primary9@example.test", "F");
    const nonContactUserId = await addRepresentative(organizationId, "not-primary@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "nominee2@example.test", "F");
    const token = await createMemberSession(env.DB, nonContactUserId, "non-primary-nominate-token");

    const response = await call(token, "/api/v1/me/organization/secondary-contact", {
      method: "PATCH",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects nominating someone who isn't an active member of the same org with 422", async () => {
    const { userId: primaryUserId } = await seedOrgWithContact("primary10@example.test", "F");
    const outsiderUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(outsiderUserId, "outsider@example.test", "outsider@example.test")
      .run();
    const token = await createMemberSession(env.DB, primaryUserId, "outsider-nominate-token");

    const response = await call(token, "/api/v1/me/organization/secondary-contact", {
      method: "PATCH",
      body: JSON.stringify({ userId: outsiderUserId }),
    });
    expect(response.status).toBe(422);
  });

  it("auto-clears a pending nomination when the nominee's membership lapses", async () => {
    const { organizationId, userId: primaryUserId } = await seedOrgWithContact("primary11@example.test", "F");
    const nomineeUserId = await addRepresentative(organizationId, "lapsing-nominee@example.test", "F");
    const token = await createMemberSession(env.DB, primaryUserId, "lapse-token");

    await call(token, "/api/v1/me/organization/secondary-contact", {
      method: "PATCH",
      body: JSON.stringify({ userId: nomineeUserId }),
    });

    const nomineeMemberRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM members WHERE user_id = ?", nomineeUserId)
    )[0];
    const patchResponse = await call(adminToken, `/api/v1/admin/members/${nomineeMemberRow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "inactive" }),
    });
    expect(patchResponse.status).toBe(200);

    const orgRows = await queryAll<{ pending_secondary_contact_user_id: string | null }>(
      env.DB,
      "SELECT pending_secondary_contact_user_id FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].pending_secondary_contact_user_id).toBeNull();
  });
});

describe("Voting delegate (PRD §4.8) + GET /api/v1/me/organization profile (§11 UI-2)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("GET /api/v1/me/organization defaults votingDelegateUserId to null and reflects it after being set", async () => {
    const { organizationId, userId } = await seedOrgWithContact("delegate-primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "delegate-get-token");

    const before = await call(token, "/api/v1/me/organization");
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { votingDelegateUserId: string | null };
    expect(beforeBody.votingDelegateUserId).toBeNull();

    const delegateUserId = await addRepresentative(organizationId, "delegate-rep@example.test", "F");
    const setResponse = await call(token, "/api/v1/me/organization/voting-delegate", {
      method: "PATCH",
      body: JSON.stringify({ userId: delegateUserId }),
    });
    expect(setResponse.status).toBe(200);

    const after = await call(token, "/api/v1/me/organization");
    const afterBody = (await after.json()) as { votingDelegateUserId: string | null };
    expect(afterBody.votingDelegateUserId).toBe(delegateUserId);
  });

  it("lets the secondary contact set and clear the voting delegate, persisting to organizations.voting_delegate_user_id", async () => {
    const { organizationId } = await seedOrgWithContact("delegate-primary2@example.test", "F");
    const secondaryUserId = await addRepresentative(organizationId, "delegate-secondary@example.test", "F");
    await env.DB.prepare("UPDATE organizations SET secondary_contact_user_id = ? WHERE id = ?")
      .bind(secondaryUserId, organizationId)
      .run();
    const delegateUserId = await addRepresentative(organizationId, "delegate-target@example.test", "F");
    const token = await createMemberSession(env.DB, secondaryUserId, "delegate-set-token");

    const setResponse = await call(token, "/api/v1/me/organization/voting-delegate", {
      method: "PATCH",
      body: JSON.stringify({ userId: delegateUserId }),
    });
    expect(setResponse.status).toBe(200);

    const setRows = await queryAll<{ voting_delegate_user_id: string | null }>(
      env.DB,
      "SELECT voting_delegate_user_id FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(setRows[0].voting_delegate_user_id).toBe(delegateUserId);

    const clearResponse = await call(token, "/api/v1/me/organization/voting-delegate", {
      method: "PATCH",
      body: JSON.stringify({ userId: null }),
    });
    expect(clearResponse.status).toBe(200);

    const clearedRows = await queryAll<{ voting_delegate_user_id: string | null }>(
      env.DB,
      "SELECT voting_delegate_user_id FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(clearedRows[0].voting_delegate_user_id).toBeNull();
  });

  it("rejects a non-contact representative's voting-delegate update with 403", async () => {
    const { organizationId } = await seedOrgWithContact("delegate-primary3@example.test", "F");
    const nonContactUserId = await addRepresentative(organizationId, "delegate-non-contact@example.test", "F");
    const token = await createMemberSession(env.DB, nonContactUserId, "delegate-non-contact-token");

    const response = await call(token, "/api/v1/me/organization/voting-delegate", {
      method: "PATCH",
      body: JSON.stringify({ userId: nonContactUserId }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("rejects a voting delegate who isn't an active member of the same org with 422", async () => {
    const { userId: primaryUserId } = await seedOrgWithContact("delegate-primary4@example.test", "F");
    const outsiderUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(outsiderUserId, "delegate-outsider@example.test", "delegate-outsider@example.test")
      .run();
    const token = await createMemberSession(env.DB, primaryUserId, "delegate-outsider-token");

    const response = await call(token, "/api/v1/me/organization/voting-delegate", {
      method: "PATCH",
      body: JSON.stringify({ userId: outsiderUserId }),
    });
    expect(response.status).toBe(422);
  });
});
