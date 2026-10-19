import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { normalizeOrgName } from "../assets/shared/organization-name";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import {
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

  it("refuses people who are not staff", async () => {
    const member = await insertUser(env.DB, "plain-member@example.test");
    const token = await createMemberSession(env.DB, member, "affiliation-review-member-token");
    await insertReview(member, "Nowhere Ltd", null);
    // A member session is not a staff session: the staff guard refuses it before any permission check.
    expect((await call(token, `${BASE}/groups`)).status).toBe(401);
    expect((await call(token, `${groupPath("Nowhere Ltd")}/dismiss`, { method: "POST" })).status).toBe(401);
  });
});
