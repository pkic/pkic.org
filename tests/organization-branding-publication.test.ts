import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { updateOrganization } from "../functions/_lib/services/organization-management/profile-update";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import {
  insertIndividualMembershipForUser,
  insertOrganization,
  insertOrgRepresentative,
  insertUser,
} from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="60" height="60" fill="#175"/></svg>';
let token: string;
let actor: UserBackedAuthAdmin;
beforeEach(async () => {
  await resetDb();
  const actorId = await insertUser(env.DB, "branding-admin@example.test");
  await grantAdministrator(env.DB, actorId);
  token = await createAdminSession(env.DB, actorId, "branding-admin");
  actor = { identityType: "user", id: actorId, email: "branding-admin@example.test", grants: administratorGrants };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 202 })),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function fixture(mode = "roster") {
  const person = await insertOrgRepresentative(env.DB);
  const slug = `branding-${crypto.randomUUID()}`;
  await insertGroupSeat(slug, { publicRoster: ["roster", "past_seat"].includes(mode) }, person);
  const groupId = (await env.DB.prepare("SELECT id FROM groups WHERE slug=?").bind(slug).first<string>("id"))!;
  await env.DB.prepare("UPDATE groups SET visibility='authenticated',public_leadership=0 WHERE id=?")
    .bind(groupId)
    .run();
  if (mode === "inherited") {
    await grantGroupLeadershipCapacity(env.DB, groupId, person.userId);
    await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,governance_inheritance_mode,public_leadership,active,created_at,updated_at)
      VALUES(?,'working_group','Inherited branding',?,?,'authenticated','inherited',1,1,?,?)`)
      .bind(crypto.randomUUID(), `${slug}-child`, groupId, nowIso(), nowIso())
      .run();
  }
  if (mode === "past_leadership") {
    await grantGroupLeadershipCapacity(env.DB, groupId, person.userId);
    await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE id=?").bind(groupId).run();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE context_id=?").bind(nowIso(), groupId).run();
  }
  if (mode === "past_seat")
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), person.identityId).run();
  await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  if (mode.startsWith("person")) {
    const personal = await insertIndividualMembershipForUser(env.DB, person.userId);
    await insertGroupSeat(`${slug}-anchor`, { publicRoster: true }, { userId: person.userId, ...personal });
    if (mode !== "person_unaddressed") await issueContributorProfileAddresses(env.DB, nowIso(), 50);
    if (mode === "person_hidden")
      await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?")
        .bind(person.identityId)
        .run();
    if (mode === "person_ended" || mode === "person_alias")
      await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), person.identityId).run();
  }
  let organizationId = person.organizationId;
  if (mode === "person_alias") {
    organizationId = await insertOrganization(env.DB, "Brand alias destination");
    await env.DB.prepare("UPDATE organizations SET merged_into_organization_id=? WHERE id=?")
      .bind(organizationId, person.organizationId)
      .run();
  }
  return { ...person, organizationId, groupId, slug };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
const projection = async () => {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, people: value.people };
};
async function patch(f: Awaited<ReturnType<typeof fixture>>, changes: Record<string, unknown>) {
  const revision = await env.DB.prepare("SELECT updated_at FROM organizations WHERE id=?")
    .bind(f.organizationId)
    .first<string>("updated_at");
  return callApi(env, `/api/v1/organizations/${f.organizationId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ revision, ...changes }),
  });
}
async function logo(f: Awaited<ReturnType<typeof fixture>>, method: "PUT" | "DELETE" = "PUT") {
  const form = new FormData();
  form.append("file", new File([SVG], "brand.svg", { type: "image/svg+xml" }));
  return callApi(env, `/api/v1/organizations/${f.organizationId}/logo`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(method === "PUT" ? { body: form } : {}),
  });
}
async function stageReview(f: Awaited<ReturnType<typeof fixture>>, changes: Record<string, unknown>, withLogo = false) {
  const id = crypto.randomUUID(),
    at = nowIso();
  const key = withLogo ? `org-logos/${f.organizationId}/staging-${id}.svg` : null;
  if (key) {
    await env.ASSETS_BUCKET!.put(key, SVG, { httpMetadata: { contentType: "image/svg+xml" } });
    await env.DB.prepare("UPDATE organizations SET logo_staging_r2_key=? WHERE id=?").bind(key, f.organizationId).run();
  }
  await env.DB.prepare(`INSERT INTO organization_content_reviews(id,organization_id,submitted_by_user_id,proposed_changes_json,logo_staging_r2_key,status,submitted_at,created_at)
    VALUES(?,?,?,?,?,'pending',?,?)`)
    .bind(id, f.organizationId, f.userId, JSON.stringify(changes), key, at, at)
    .run();
  return { id, key };
}
async function approve(id: string) {
  return callApi(env, `/api/v1/organizations/content-reviews/${id}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
}
async function review(f: Awaited<ReturnType<typeof fixture>>, changes: Record<string, unknown>, withLogo = false) {
  return approve((await stageReview(f, changes, withLogo)).id);
}
async function change(f: Awaited<ReturnType<typeof fixture>>, operation: string) {
  if (operation === "logo") return logo(f);
  if (operation === "review_logo") return review(f, {}, true);
  return patch(f, { name: "Updated public branding" });
}
const organizationState = (id: string) =>
  queryAll(env.DB, "SELECT name,website,logo_r2_key,logo_staging_r2_key,updated_at FROM organizations WHERE id=?", [
    id,
  ]);
describe("publication of organization branding beyond active Member pages", () => {
  it("publishes a person-only logo after the guarded pointer replacement", async () => {
    const f = await fixture("person"),
      recorded = await requests(),
      before = await projection();
    expect((await logo(f)).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    const queued = await requests();
    expect(queued).toHaveLength(recorded.length + 1);
    expect(queued.slice(0, -1)).toEqual(recorded);
    expect(queued.at(-1)).toMatchObject({ resource_type: "organization_content", resource_id: f.organizationId });
  });
  it.each([false, true])("uses live Member eligibility for inherited branding: %s", async (active) => {
    const f = await fixture("inherited");
    if (active) await env.DB.prepare("UPDATE members SET status='active' WHERE id=?").bind(f.memberId).run();
    const before = await projection();
    expect(before.groups[`${f.slug}-child`]?.leadership).toHaveLength(active ? 1 : 0);
    expect((await patch(f, { name: "Inherited branding update" })).status).toBe(200);
    if (active) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(active ? 1 : 0);
  });

  it.each(
    ["past_seat", "past_leadership", "person_ended", "person_alias"].flatMap((mode) =>
      ["name", "review_logo"].map((operation) => ({ mode, operation })),
    ),
  )("publishes historical and alias branding: %j", async ({ mode, operation }) => {
    const f = await fixture(mode),
      recorded = await requests(),
      before = await projection();
    expect((await change(f, operation)).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    const queued = await requests();
    expect(queued).toHaveLength(recorded.length + 1);
    expect(queued.slice(0, -1)).toEqual(recorded);
    expect(queued.at(-1)).toMatchObject({ resource_type: "organization_content", resource_id: f.organizationId });
  });
  it.each(
    ["person_hidden", "person_unaddressed", "private"].flatMap((mode) =>
      ["name", "logo"].map((operation) => ({ mode, operation })),
    ),
  )("keeps unpublished branding quiet: %j", async ({ mode, operation }) => {
    const f = await fixture(mode),
      recorded = await requests(),
      before = await projection();
    expect((await change(f, operation)).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toEqual(recorded);
  });
  it.each([
    { description: "Not in the roster" },
    { blogUrl: "https://blog.example.test/" },
    { memberSince: "2020-01-01" },
    { website: null },
  ])("keeps unused or unchanged group fields quiet: %j", async (changes) => {
    const f = await fixture(),
      before = await projection();
    expect((await patch(f, changes)).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it("keeps category-driven seat withdrawal with the existing enrollment publisher", async () => {
    const f = await fixture(),
      before = await projection();
    expect((await patch(f, { membershipCategory: "B" })).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toEqual([
      expect.objectContaining({
        resource_type: "user_profile",
        resource_id: f.userId,
        reason_code: "user_profile_changed",
      }),
    ]);
  });
  it.each(["website", "unchanged_review"])(
    "does not publish unused person website or unchanged approval: %s",
    async (operation) => {
      const f = await fixture("person"),
        recorded = await requests(),
        before = await projection();
      const response =
        operation === "website"
          ? await patch(f, { website: "https://unused.example.test/" })
          : await review(f, { website: null });
      expect(response.status).toBe(200);
      expect(await projection()).toEqual(before);
      expect(await requests()).toEqual(recorded);
    },
  );
  it("keeps one intent for overlapping active Member and group branding", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE members SET status='active' WHERE id=?").bind(f.memberId).run();
    expect((await patch(f, { name: "Overlapping branding", website: "https://overlap.example.test/" })).status).toBe(
      200,
    );
    expect(await requests()).toHaveLength(1);
  });
  it("publishes logo replacement/removal and resolves the selected public image", async () => {
    const f = await fixture();
    expect((await logo(f)).status).toBe(200);
    const snapshot = await readSitePublicationSnapshot(env.DB, []);
    const references = publishedMediaReferences(snapshot);
    expect(references).toHaveLength(1);
    const resolved = await resolvePublishedMediaKeys(env.DB, references);
    expect(await env.ASSETS_BUCKET!.get(resolved[references[0]!]!)).not.toBeNull();
    const image = await callApi(env, references[0]!);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/");
    expect((await logo(f, "DELETE")).status).toBe(200);
    expect(await requests()).toHaveLength(2);
    expect(publishedMediaReferences(await readSitePublicationSnapshot(env.DB, []))).toEqual([]);
    expect((await logo(f, "DELETE")).status).toBe(200);
    expect(await requests()).toHaveLength(2);
  });
  it.each(
    ["profile", "logo", "review"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back branding and retries after %j", async ({ operation, failure }) => {
    const f = await fixture();
    if (operation === "logo") expect((await logo(f)).status).toBe(200);
    const staged = operation === "review" ? await stageReview(f, {}, true) : null;
    const state = await organizationState(f.organizationId),
      recorded = await requests(),
      before = await projection();
    const objects = (await env.ASSETS_BUCKET!.list({ prefix: `org-logos/${f.organizationId}/` })).objects
      .map((row) => row.key)
      .sort();
    const auditAction =
      operation === "profile"
        ? "organization_updated"
        : operation === "logo"
          ? "organization_logo_uploaded"
          : "organization_content_review_approved";
    await env.DB.prepare(
      failure === "request"
        ? "CREATE TRIGGER fail_branding BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_BRANDING_FAILURE'); END"
        : `CREATE TRIGGER fail_branding BEFORE INSERT ON audit_log WHEN NEW.action='${auditAction}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_BRANDING_FAILURE'); END`,
    ).run();
    const attempt = () =>
      operation === "profile"
        ? patch(f, { name: "Atomic branding" })
        : operation === "logo"
          ? logo(f)
          : approve(staged!.id);
    try {
      expect((await attempt()).status).toBe(500);
      expect(await organizationState(f.organizationId)).toEqual(state);
      expect(await requests()).toEqual(recorded);
      expect(await projection()).toEqual(before);
      expect(
        (await env.ASSETS_BUCKET!.list({ prefix: `org-logos/${f.organizationId}/` })).objects
          .map((row) => row.key)
          .sort(),
      ).toEqual(objects);
      if (staged)
        expect(
          await queryAll(env.DB, "SELECT status FROM organization_content_reviews WHERE id=?", [staged.id]),
        ).toEqual([{ status: "pending" }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_branding").run();
    }
    expect((await attempt()).status).toBe(200);
    expect(await requests()).toHaveLength(recorded.length + 1);
    expect(await projection()).not.toEqual(before);
  });
  it.each(["authority", "revision", "visibility"])(
    "uses committing branding/permission state after a %s race",
    async (race) => {
      const f = await fixture(),
        [basis] = await organizationState(f.organizationId);
      const revision = basis!.updated_at as string;
      const raced = mutateBeforeNextBatch(env.DB, () =>
        race === "authority"
          ? env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), actor.id).run()
          : race === "revision"
            ? env.DB.prepare("UPDATE organizations SET updated_at='2035-01-01T00:00:00.000Z' WHERE id=?")
                .bind(f.organizationId)
                .run()
            : env.DB.prepare("UPDATE groups SET public_roster=0 WHERE id=?").bind(f.groupId).run(),
      );
      const pending = updateOrganization(raced, actor, f.organizationId, { revision, name: "Racing branding" });
      if (race === "visibility") await pending;
      else await expect(pending).rejects.toMatchObject({ status: 409 });
      expect(await requests()).toEqual([]);
      if (race !== "visibility") expect((await organizationState(f.organizationId))[0]!.name).toBe(basis!.name);
    },
  );

  it.each(["name", "website", "logo", "review"])(
    "publishes a public group branding change through %s",
    async (operation) => {
      const f = await fixture();
      const before = await projection();
      const response =
        operation === "logo"
          ? await logo(f)
          : operation === "review"
            ? await review(f, { website: "https://updated.example.test/" })
            : await patch(
                f,
                operation === "name"
                  ? { name: "Updated organization branding" }
                  : { website: "https://updated.example.test/" },
              );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests()).toEqual([
        expect.objectContaining({ resource_type: "organization_content", resource_id: f.organizationId }),
      ]);
    },
  );
  it("publishes an organization rename on an addressed person page", async () => {
    const f = await fixture("person");
    const recorded = await requests();
    const before = await projection();
    expect(before.people?.[f.userId]).toBeDefined();
    expect((await patch(f, { name: "Updated person affiliation" })).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(recorded.length + 1);
    expect((await requests()).slice(0, -1)).toEqual(recorded);
  });
  it("keeps a private organization rename quiet", async () => {
    const f = await fixture("private");
    const before = await projection();
    expect((await patch(f, { name: "Private renamed organization" })).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toEqual([]);
  });
});
