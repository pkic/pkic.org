import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../functions/router";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertOrgRepresentative,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { publicMemberDetailSchema } from "../assets/shared/schemas/members-directory";
import { nowIso } from "../functions/_lib/utils/time";

it("keeps directory, search, wall, and profile reads bounded and replica eligible", async () => {
  const organizationId = await insertOrganization(env.DB, "Profile Fixture");
  await seedOrganizationAggregate(env.DB, organizationId, "A");
  for (const [path, expectedTrips, expectedStatements] of [
    ["/api/v1/members?group=organization&limit=12", 1, 2],
    ["/api/v1/members?q=Profile&limit=12", 1, 2],
    ["/api/v1/members/wall?limit=12", 1, 1],
    [`/api/v1/members/${organizationId}`, 1, 2],
  ] as const) {
    const profile = profileD1Flow(env.DB);
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://app.test${path}`), { ...env, DB: profile.db }, ctx);
    expect(response.status, path).toBe(200);
    await response.json();
    await waitOnExecutionContext(ctx);
    const report = await profile.report();
    expect(report.constraints, path).toEqual(["first-unconstrained"]);
    expect(report.roundTrips, path).toBe(expectedTrips);
    expect(report.statements, path).toBe(expectedStatements);
    if (path === `/api/v1/members/${organizationId}`) {
      const detailPlan = JSON.stringify(report.plans[0]?.plan);
      expect(detailPlan).toContain("SEARCH m USING INDEX");
      expect(detailPlan).not.toContain('"detail":"SCAN m"');
      const rosterPlan = JSON.stringify(report.plans[1]?.plan);
      expect(rosterPlan).toContain("SEARCH identity USING INDEX");
      expect(rosterPlan).not.toContain('"detail":"SCAN identity"');
    }
    console.log("D1_FLOW_PROFILE", JSON.stringify({ path, ...report }));
  }
});

it("batches the same profile and public roster for ID and slug lookups", async () => {
  const member = await insertOrgRepresentative(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE organizations SET slug = 'batched-profile' WHERE id = ?").bind(member.organizationId),
    env.DB.prepare("UPDATE identities SET job_title = 'Public representative' WHERE id = ?").bind(member.identityId),
  ]);
  for (const state of ["hidden", "blocked", "ended", "not-started"] as const) {
    const userId = await insertUser(env.DB);
    const identityId = await addRepresentative(env.DB, member.memberId, userId, {
      jobTitle: state,
      showOnOrgProfile: state !== "hidden",
    });
    const updates = {
      hidden: "show_on_organization_profile = 0",
      blocked: "blocked_at = ?, ended_at = ?",
      ended: "ended_at = ?",
      "not-started": "started_at = NULL",
    };
    const now = nowIso();
    const bindings =
      state === "blocked" ? [now, now, identityId] : state === "ended" ? [now, identityId] : [identityId];
    await env.DB.prepare(`UPDATE identities SET ${updates[state]} WHERE id = ?`)
      .bind(...bindings)
      .run();
  }
  const byId = publicMemberDetailSchema.parse(await readProfile(member.organizationId));
  const bySlug = publicMemberDetailSchema.parse(await readProfile("batched-profile"));
  expect(byId).toEqual(bySlug);
  expect(byId.identities).toEqual([expect.objectContaining({ jobTitle: "Public representative" })]);

  const individual = await insertIndividualMember(env.DB);
  expect(publicMemberDetailSchema.parse(await readProfile(individual.memberId)).identities).toEqual([]);
  await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(member.memberId).run();
  await readProfile(member.organizationId, 404);
  await readProfile("batched-profile", 404);
  await readProfile(crypto.randomUUID(), 404);
});

it("never pairs one member's profile with another member's roster on an ID/slug collision", async () => {
  const left = await insertOrgRepresentative(env.DB);
  const right = await insertOrgRepresentative(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE organizations SET slug = ? WHERE id = ?").bind(left.organizationId, right.organizationId),
    env.DB.prepare("UPDATE identities SET job_title = 'Left representative' WHERE id = ?").bind(left.identityId),
    env.DB.prepare("UPDATE identities SET job_title = 'Right representative' WHERE id = ?").bind(right.identityId),
  ]);
  const detail = publicMemberDetailSchema.parse(await readProfile(left.organizationId));
  const chosen = left.memberId < right.memberId ? left : right;
  expect(detail.id).toBe(chosen.organizationId);
  expect(detail.identities).toEqual([
    expect.objectContaining({ jobTitle: chosen === left ? "Left representative" : "Right representative" }),
  ]);
});

async function readProfile(idOrSlug: string, status = 200): Promise<unknown> {
  const profile = profileD1Flow(env.DB);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://app.test/api/v1/members/${idOrSlug}`),
    { ...env, DB: profile.db },
    ctx,
  );
  expect(response.status).toBe(status);
  const body: unknown = await response.json();
  await waitOnExecutionContext(ctx);
  const report = await profile.report();
  expect(report.constraints).toEqual(["first-unconstrained"]);
  expect(report.roundTrips).toBe(1);
  expect(report.statements).toBe(2);
  return body;
}

it("resolves organization, member, and identity images in one indexed replica-eligible query", async () => {
  const organizationId = await insertOrganization(env.DB, "Image Profile Fixture");
  const { userId, memberId, identityId } = await insertIndividualMember(env.DB);
  const imageKey = "member-photos/query-profile/photo.png";
  await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(imageKey, userId).run();
  await env.ASSETS_BUCKET!.put(imageKey, new Uint8Array([1, 2, 3]));

  // IDs belong to separate tables: a matching organization without a logo
  // must not fall through to another entity's headshot, even on a collision.
  await env.DB.prepare("UPDATE organizations SET id = ? WHERE id = ?").bind(identityId, organizationId).run();
  for (const [id, status] of [
    [memberId, 200],
    [identityId, 404],
    [crypto.randomUUID(), 404],
  ] as const) {
    await assertImageFlow(id, status);
  }
  await env.DB.prepare("UPDATE organizations SET id = ? WHERE id = ?").bind(organizationId, identityId).run();
  await assertImageFlow(identityId, 200);
  await env.DB.prepare("UPDATE organizations SET logo_r2_key = ? WHERE id = ?").bind(imageKey, organizationId).run();
  await assertImageFlow(organizationId, 200);
});

async function assertImageFlow(id: string, status: number): Promise<void> {
  const profile = profileD1Flow(env.DB);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://app.test/api/v1/members/${id}/logo`),
    { ...env, DB: profile.db },
    ctx,
  );
  expect(response.status).toBe(status);
  await response.arrayBuffer();
  await waitOnExecutionContext(ctx);
  const report = await profile.report();
  expect(report.constraints).toEqual(["first-unconstrained"]);
  expect(report.roundTrips).toBe(1);
  expect(report.statements).toBe(1);
  const plan = JSON.stringify(report.plans[0]?.plan);
  for (const table of ["organizations", "m", "identity", "u"]) {
    expect(plan).toContain(`SEARCH ${table} USING INDEX`);
    expect(plan).not.toContain(`"detail":"SCAN ${table}"`);
  }
  console.log("D1_IMAGE_FLOW_PROFILE", JSON.stringify({ status, ...report }));
}
