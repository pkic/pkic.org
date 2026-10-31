import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { organizationsListResponseSchema } from "../assets/shared/schemas/organization-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { prepareClaimDomainForOrganization } from "../functions/_lib/services/membership/organization-domain-claims";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
async function actor() {
  const { admin } = await seedEventAndAdmin(env.DB);
  return createAdminSession(env.DB, admin.id, crypto.randomUUID());
}
async function claimed(name: string, domain: string) {
  const id = await insertOrganization(env.DB, name);
  const statement = await prepareClaimDomainForOrganization(env.DB, { domain, organizationId: id, now: nowIso() });
  await env.DB.batch([statement!]);
  return id;
}
function page(token: string, id: string, query = "") {
  return callApi(
    env,
    `/api/v1/organizations?relatedToOrganizationId=${id}${query}`,
    { headers: { authorization: `Bearer ${token}` } },
    { maxRoundTrips: 1 },
  );
}
async function derived(name: string, domain: string) {
  const id = await insertOrganization(env.DB, name);
  const userId = await insertUser(env.DB, `${crypto.randomUUID()}@${domain}`);
  await env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?")
    .bind(nowIso(), userId)
    .run();
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: id,
    source: "verified_email",
    verifiedEmailDomain: domain,
    jobTitle: "Engineer",
    startImmediately: true,
  });
  await env.DB.batch([identity.statement]);
  return { id, userId, identityId: identity.identityId };
}

describe("organizations connected by email domain", () => {
  it("lists parent, child and shared-domain organizations once using server pagination, search and sort", async () => {
    const token = await actor();
    const parent = await claimed("Parent", "example-work.test");
    const child = await claimed("Child", "us.example-work.test");
    const shared = await derived("Shared", "us.example-work.test");
    await claimed("Unrelated", "example-work.test.other.test");
    const first = await page(token, parent, "&limit=1&sort=name");
    expect(first.status, await first.clone().text()).toBe(200);
    const firstPage = organizationsListResponseSchema.parse(await first.json());
    expect(firstPage.organizations.map((organization) => organization.id)).toEqual([child]);
    expect(firstPage.page).toMatchObject({ total: 2, hasMore: true });
    const second = organizationsListResponseSchema.parse(
      await (await page(token, parent, "&limit=1&offset=1&sort=name")).json(),
    );
    expect(second.organizations.map((organization) => organization.id)).toEqual([shared.id]);
    const searched = organizationsListResponseSchema.parse(await (await page(token, child, "&q=Parent")).json());
    expect(searched.organizations.map((organization) => organization.id)).toEqual([parent]);
  });
  it.each(["ended", "blocked", "inactive"] as const)("excludes %s derived connections", async (state) => {
    const token = await actor();
    const parent = await claimed("Parent", "example-work.test");
    const connected = await derived("Inactive connection", "example-work.test");
    if (state === "inactive") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(connected.userId).run();
    else
      await env.DB.prepare(`UPDATE identities SET ended_at=?${state === "blocked" ? ",blocked_at=?" : ""} WHERE id=?`)
        .bind(...(state === "blocked" ? [nowIso(), nowIso(), connected.identityId] : [nowIso(), connected.identityId]))
        .run();
    const response = await page(token, parent);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(organizationsListResponseSchema.parse(await response.json()).organizations).toEqual([]);
  });
  it("does not reveal organization connections to an unauthorized account", async () => {
    await actor();
    const parent = await claimed("Parent", "example-work.test");
    const id = await insertUser(env.DB, "outsider@other.test");
    const token = await createAdminSession(env.DB, id, crypto.randomUUID());
    expect((await page(token, parent)).status).toBe(403);
  });
});
