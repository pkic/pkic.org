import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { normalizeOrgName } from "../assets/shared/organization-name";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, seedOrganizationAggregate, insertOrganization, insertUser } from "./helpers/membership";
import {
  affiliationReviewApproveResponseSchema,
  affiliationReviewGroupDecisionResponseSchema,
  affiliationReviewGroupsListResponseSchema,
  affiliationReviewsListResponseSchema,
} from "../assets/shared/schemas/affiliation-reviews";

const BASE = "/api/v1/identities/reviews";
const groupPath = (name: string) => `${BASE}/groups/${encodeURIComponent(normalizeOrgName(name))}`;

function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

/** A review as the migration records it: grouped by the name as written. */
async function insertReview(
  userId: string,
  organizationName: string,
  jobTitle: string | null,
  emailDomain: string | null = null,
) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const normalized = normalizeOrgName(organizationName);
  await env.DB.prepare(
    `INSERT INTO affiliation_reviews (id, user_id, organization_name, normalized_name, job_title, email_domain, group_key,
       source_type, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user_profile', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, userId, organizationName, normalized, jobTitle, emailDomain, normalized, id)
    .run();
  return id;
}

describe("affiliation reviews by group", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0]
      .id;
    adminToken = await createAdminSession(env.DB, adminId, "affiliation-review-admin-token");
  });

  it("lists one group per name as written with how many people wrote it", async () => {
    const first = await insertUser(env.DB, "first@example.test");
    const second = await insertUser(env.DB, "second@example.test");
    const third = await insertUser(env.DB, "third@example.test");
    await insertReview(first, "Solo Consulting", "Advisor", "solo.example");
    await insertReview(second, "SOLO  consulting", null);
    await insertReview(third, "Elsewhere Inc", null);

    const listed = affiliationReviewGroupsListResponseSchema.parse(
      await (await call(adminToken, `${BASE}/groups`)).json(),
    );
    expect(listed.groups.map((group) => [group.groupKey, group.people, group.openReviews, group.emailDomains])).toEqual(
      [
        ["solo consulting", 2, 2, ["solo.example"]],
        ["elsewhere inc", 1, 1, []],
      ],
    );
    const members = affiliationReviewsListResponseSchema.parse(
      await (await call(adminToken, `${BASE}?groupKey=${encodeURIComponent("solo consulting")}`)).json(),
    );
    expect(members.reviews).toHaveLength(2);
  });

  it("never links people to an organization by the name they wrote", async () => {
    const organizationId = await insertOrganization(env.DB, "Solo Consulting");
    const person = await insertUser(env.DB, "fresh@example.test");
    await insertReview(person, "Solo Consulting", "Architect");
    const response = await call(adminToken, `${groupPath("Solo Consulting")}/resolve`, {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    });
    expect(response.status).toBe(404);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id = ?", [organizationId])).toEqual([]);
  });

  it("dismisses a whole group, audits each review and refuses a second decision", async () => {
    const first = await insertUser(env.DB, "dismiss-one@example.test");
    const second = await insertUser(env.DB, "dismiss-two@example.test");
    await insertReview(first, "Nowhere", "CTO");
    await insertReview(second, "nowhere", null);

    const response = await call(adminToken, `${groupPath("Nowhere")}/dismiss`, { method: "POST" });
    expect(affiliationReviewGroupDecisionResponseSchema.parse(await response.json())).toMatchObject({
      decided: 2,
      group: { status: "dismissed", openReviews: 0 },
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT actor_id, COUNT(*) AS count FROM audit_log WHERE action = 'affiliation_review_dismissed' GROUP BY actor_id",
      ),
    ).toEqual([{ actor_id: adminId, count: 2 }]);
    expect((await call(adminToken, `${groupPath("Nowhere")}/dismiss`, { method: "POST" })).status).toBe(409);
    expect((await call(adminToken, `${groupPath("Unknown group")}/dismiss`, { method: "POST" })).status).toBe(404);
  });

  async function approvedOrganization(): Promise<string> {
    const organizationId = await insertOrganization(env.DB, "IBM");
    await seedOrganizationAggregate(env.DB, organizationId);
    await env.DB.prepare(`INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at)
      VALUES (?, 'ibm.example', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(crypto.randomUUID(), organizationId)
      .run();
    return organizationId;
  }
  async function verifiedPerson(email: string): Promise<string> {
    const userId = await insertUser(env.DB, email);
    await env.DB.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(userId)
      .run();
    return userId;
  }
  async function approve(body: unknown = {}, token = adminToken) {
    const response = await call(token, `${groupPath("IBM")}/approve`, { method: "POST", body: JSON.stringify(body) });
    expect(response.status, await response.clone().text()).toBe(200);
    return affiliationReviewApproveResponseSchema.parse(await response.json());
  }

  it("approves one verified person across review sources and safely retries", async () => {
    const organizationId = await approvedOrganization();
    const person = await verifiedPerson("one@ibm.example");
    const other = await verifiedPerson("two@ibm.example");
    const ids = [
      await insertReview(person, "IBM", "Architect", "ibm.example"),
      await insertReview(person, "IBM", null, "ibm.example"),
    ];
    await env.DB.prepare("UPDATE affiliation_reviews SET source_type = 'registration' WHERE id = ?").bind(ids[1]).run();
    await insertReview(other, "IBM", null, "ibm.example");
    await insertReview(person, "Past Employer", null, "elsewhere.example");
    expect(await approve({ userId: person })).toMatchObject({
      decided: 2,
      nextUserId: null,
      group: { openReviews: 1 },
    });
    expect(await approve({ userId: person })).toMatchObject({ decided: 0 });
    expect(await queryAll(env.DB, "SELECT organization_id FROM identities WHERE user_id = ?", [person])).toEqual([
      { organization_id: organizationId },
    ]);
    expect(
      await queryAll(env.DB, "SELECT resolved_by_user_id FROM affiliation_reviews WHERE id IN (?, ?) ORDER BY id", ids),
    ).toEqual([{ resolved_by_user_id: adminId }, { resolved_by_user_id: adminId }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM affiliation_reviews WHERE user_id = ? AND resolved_at IS NULL", [person]),
    ).toHaveLength(1);
  });

  it("does not approve a different named employer through the person's matching work domain", async () => {
    await approvedOrganization();
    const person = await verifiedPerson("conflicting@ibm.example");
    const id = await insertReview(person, "Other Employer", null, "ibm.example");
    const response = await call(adminToken, `${groupPath("Other Employer")}/approve`, { method: "POST", body: "{}" });
    expect(affiliationReviewApproveResponseSchema.parse(await response.json()).decided).toBe(0);
    expect(await queryAll(env.DB, "SELECT resolved_at FROM affiliation_reviews WHERE id = ?", [id])).toEqual([
      { resolved_at: null },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ? AND organization_id IS NOT NULL", [person]),
    ).toEqual([]);
  });

  it("counts only matching reviews closed by overlapping approval passes", async () => {
    await approvedOrganization();
    const person = await verifiedPerson("concurrent@ibm.example");
    await insertReview(person, "IBM", null, "ibm.example");
    await insertReview(person, "IBM", null, null);
    const conflict = await insertReview(person, "Other Employer", null, "ibm.example");
    // A domain-grouped historical import can contain different written names.
    await env.DB.prepare("UPDATE affiliation_reviews SET group_key = 'ibm' WHERE id = ?").bind(conflict).run();
    const results = await Promise.all([approve({ userId: person }), approve({ userId: person })]);
    expect(results.reduce((sum, result) => sum + result.decided, 0)).toBe(2);
    expect(
      await queryAll(env.DB, "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'affiliation_review_resolved'"),
    ).toEqual([{ total: 2 }]);
    expect(await queryAll(env.DB, "SELECT resolved_at FROM affiliation_reviews WHERE id = ?", [conflict])).toEqual([
      { resolved_at: null },
    ]);
  });

  it("repairs stale reviews for an active identity without duplicating it", async () => {
    const organizationId = await approvedOrganization();
    const person = await verifiedPerson("existing@ibm.example");
    const member = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM members WHERE organization_id = ?", [organizationId])
    )[0].id;
    const identityId = await addRepresentative(env.DB, member, person);
    await insertReview(person, "IBM", null, "ibm.example");
    expect(await approve()).toMatchObject({ decided: 1, group: { openReviews: 0 } });
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ?", [person])).toEqual([
      { id: identityId },
    ]);
  });

  it("approves all in bounded passes and advances past unverified people", async () => {
    await approvedOrganization();
    for (let index = 0; index < 7; index += 1) {
      const person =
        index === 0
          ? await insertUser(env.DB, "unverified@ibm.example")
          : await verifiedPerson(`batch${index}@ibm.example`);
      await insertReview(person, "IBM", null, "ibm.example");
    }
    const first = await approve();
    expect(first.nextUserId).not.toBeNull();
    const second = await approve({ afterUserId: first.nextUserId });
    expect(second.nextUserId).toBeNull();
    expect(first.decided + second.decided).toBe(6);
    expect(second.group.openReviews).toBe(1);
  });

  it("keeps blocked, ended, dismissed, and unrelated affiliations open", async () => {
    const organizationId = await approvedOrganization();
    const member = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM members WHERE organization_id = ?", [organizationId])
    )[0].id;
    for (const state of ["blocked", "ended", "dismissed", "unrelated"]) {
      const person = await verifiedPerson(`${state}@ibm.example`);
      await insertReview(
        person,
        state === "unrelated" ? "Unrelated employer" : "IBM",
        null,
        state === "unrelated" ? "other.example" : "ibm.example",
      );
      if (state === "blocked" || state === "ended") {
        const identity = await addRepresentative(env.DB, member, person);
        await env.DB.prepare(
          state === "blocked"
            ? "UPDATE identities SET blocked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
            : "UPDATE identities SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        )
          .bind(identity)
          .run();
      } else if (state === "dismissed") {
        await env.DB.prepare(
          "INSERT INTO affiliation_offer_dismissals(id,user_id,organization_id,created_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
          .bind(crypto.randomUUID(), person, organizationId)
          .run();
      }
    }
    expect(await approve()).toMatchObject({ decided: 0, group: { openReviews: 3 } });
    const unrelated = await call(adminToken, `${groupPath("Unrelated employer")}/approve`, {
      method: "POST",
      body: "{}",
    });
    expect(affiliationReviewApproveResponseSchema.parse(await unrelated.json()).decided).toBe(0);
  });

  it("rolls back identity and review approval when its audit cannot be recorded", async () => {
    await approvedOrganization();
    const person = await verifiedPerson("rollback@ibm.example");
    const reviewId = await insertReview(person, "IBM", null, "ibm.example");
    await env.DB.prepare(`CREATE TRIGGER reject_review_approval BEFORE INSERT ON audit_log
      WHEN NEW.action = 'affiliation_review_resolved' BEGIN SELECT RAISE(ABORT, 'test review audit failure'); END`).run();
    try {
      const response = await call(adminToken, `${groupPath("IBM")}/approve`, { method: "POST", body: "{}" });
      expect(response.status).toBe(500);
      expect(
        await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ? AND organization_id IS NOT NULL", [person]),
      ).toEqual([]);
      expect(await queryAll(env.DB, "SELECT resolved_at FROM affiliation_reviews WHERE id = ?", [reviewId])).toEqual([
        { resolved_at: null },
      ]);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_review_approval").run();
    }
  });

  it("requires identity activation in addition to users write", async () => {
    await approvedOrganization();
    const person = await verifiedPerson("reviewer@ibm.example");
    await insertReview(person, "IBM", null);
    await env.DB.prepare(
      `INSERT INTO permission_grants(id,user_id,permission,created_at) VALUES(?,?,'users:write',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(crypto.randomUUID(), person)
      .run();
    const token = await createMemberSession(env.DB, person, "limited-reviewer");
    expect((await call(token, `${groupPath("IBM")}/approve`, { method: "POST", body: "{}" })).status).toBe(403);
    expect(
      (
        await call(adminToken, `${groupPath("IBM")}/approve`, {
          method: "POST",
          body: JSON.stringify({ userId: person, afterUserId: person }),
        })
      ).status,
    ).toBe(400);
  });

  it("refuses people who are not staff", async () => {
    const member = await insertUser(env.DB, "plain-member@example.test");
    const token = await createMemberSession(env.DB, member, "affiliation-review-member-token");
    await insertReview(member, "Nowhere Ltd", null);
    // The valid human session carries no staff authority.
    expect((await call(token, `${BASE}/groups`)).status).toBe(403);
    expect((await call(token, `${groupPath("Nowhere Ltd")}/dismiss`, { method: "POST" })).status).toBe(403);
  });
});
