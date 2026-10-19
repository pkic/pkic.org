import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { updateOrganization } from "../functions/_lib/services/organization-management/profile-update";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { versionedImagePath } from "../functions/_lib/services/image-cache";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="60" height="60" fill="#175"/></svg>';
let token: string;
let reviewerId: string;
let actor: UserBackedAuthAdmin;
beforeEach(async () => {
  await resetDb();
  reviewerId = await insertUser(env.DB, "sponsor-branding-admin@example.test");
  await grantAdministrator(env.DB, reviewerId);
  token = await createAdminSession(env.DB, reviewerId, "sponsor-branding-admin");
  actor = {
    identityType: "user",
    id: reviewerId,
    email: "sponsor-branding-admin@example.test",
    grants: administratorGrants,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 202 })),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function fixture(type = "consortium", listed = true, withMember = true) {
  const organizationId = await insertOrganization(env.DB, "Sponsor branding organization");
  const memberId = withMember ? await seedOrganizationAggregate(env.DB, organizationId) : null;
  if (memberId) await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
  let eventId: string | null = null;
  if (type === "consortium")
    await env.DB.prepare("UPDATE organizations SET sponsor_tier=? WHERE id=?")
      .bind(listed ? "Gold" : "Unlisted", organizationId)
      .run();
  else {
    eventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES(?,'sponsor-brand-event','Sponsor branding event','UTC','invitation_only',?,?)",
    )
      .bind(eventId, nowIso(), nowIso())
      .run();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'Leader',?,?,?)",
    )
      .bind(crypto.randomUUID(), organizationId, eventId, listed ? "active" : "new_inquiry", nowIso(), nowIso())
      .run();
  }
  const selections: Array<Record<string, string | undefined>> =
    type === "consortium" ? [{}] : [{ eventSlug: "sponsor-brand-event" }];
  return { organizationId, memberId, eventId, selections };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
const projection = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await readSitePublicationSnapshot(env.DB, f.selections)).sponsors;
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
  form.append("file", new File([SVG], "sponsor.svg", { type: "image/svg+xml" }));
  return callApi(env, `/api/v1/organizations/${f.organizationId}/logo`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(method === "PUT" ? { body: form } : {}),
  });
}
async function stageReview(f: Awaited<ReturnType<typeof fixture>>, withLogo = false) {
  const id = crypto.randomUUID(),
    at = nowIso(),
    key = withLogo ? `org-logos/${f.organizationId}/staging-${crypto.randomUUID()}.svg` : null;
  if (key) {
    await env.ASSETS_BUCKET!.put(key, SVG, { httpMetadata: { contentType: "image/svg+xml" } });
    await env.DB.prepare("UPDATE organizations SET logo_staging_r2_key=? WHERE id=?").bind(key, f.organizationId).run();
  }
  await env.DB.prepare(`INSERT INTO organization_content_reviews(id,organization_id,submitted_by_user_id,proposed_changes_json,logo_staging_r2_key,status,submitted_at,created_at)
    VALUES(?,?,?,?,?,'pending',?,?)`)
    .bind(
      id,
      f.organizationId,
      reviewerId,
      JSON.stringify(withLogo ? {} : { website: "https://approved.example.test/" }),
      key,
      at,
      at,
    )
    .run();
  return id;
}
async function approve(id: string) {
  return callApi(env, `/api/v1/organizations/content-reviews/${id}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
}
async function review(f: Awaited<ReturnType<typeof fixture>>, withLogo = false) {
  return approve(await stageReview(f, withLogo));
}
async function change(f: Awaited<ReturnType<typeof fixture>>, operation: string) {
  if (operation === "logo") return logo(f);
  if (operation === "review") return review(f);
  if (operation === "review_logo") return review(f, true);
  return patch(
    f,
    operation === "name" ? { name: "Updated sponsor branding" } : { website: "https://updated.example.test/" },
  );
}
describe("publication of existing public sponsor branding", () => {
  it.each(["name", "logo", "review", "review_logo"])(
    "publishes event sponsor branding through %s",
    async (operation) => {
      const f = await fixture("event"),
        before = await projection(f);
      expect((await change(f, operation)).status).toBe(200);
      expect(await projection(f)).not.toEqual(before);
      expect(await requests()).toHaveLength(1);
    },
  );
  it.each(["new_inquiry", "lapsed"])("keeps an event sponsor at %s quiet", async (stage) => {
    const f = await fixture("event");
    await env.DB.prepare("UPDATE sponsorships SET pipeline_stage=? WHERE organization_id=?")
      .bind(stage, f.organizationId)
      .run();
    const before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    expect(await projection(f)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it.each(["consortium", "event"])("respects inactive %s tier visibility", async (type) => {
    const f = await fixture(type);
    const tiers = await queryAll<{ tier: string; active: number }>(
      env.DB,
      "SELECT tier,active FROM sponsorship_tier_catalog WHERE sponsor_type=?",
      [type],
    );
    try {
      await env.DB.prepare("UPDATE sponsorship_tier_catalog SET active=0 WHERE sponsor_type=?").bind(type).run();
      const before = await projection(f);
      expect((await change(f, "website")).status).toBe(200);
      expect(await projection(f)).toEqual(before);
      expect(await requests()).toEqual([]);
    } finally {
      await env.DB.batch(
        tiers.map((row) =>
          env.DB.prepare("UPDATE sponsorship_tier_catalog SET active=? WHERE sponsor_type=? AND tier=?").bind(
            row.active,
            type,
            row.tier,
          ),
        ),
      );
    }
  });
  it.each([false, true])("uses the latest active event row, not any older listed tier: %s", async (newerActive) => {
    const f = await fixture("event");
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'Unlisted',?,'2035-01-01T00:00:00.000Z','2035-01-01T00:00:00.000Z')",
    )
      .bind(crypto.randomUUID(), f.organizationId, f.eventId, newerActive ? "active" : "new_inquiry")
      .run();
    const before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    if (newerActive) expect(await projection(f)).toEqual(before);
    else expect(await projection(f)).not.toEqual(before);
    expect(await requests()).toHaveLength(newerActive ? 0 : 1);
  });
  it("checks separate event views when the newest row hides a different event", async () => {
    const f = await fixture("event");
    await env.DB.prepare(
      "UPDATE sponsorships SET tier='Unlisted',updated_at='2035-01-01T00:00:00.000Z' WHERE organization_id=?",
    )
      .bind(f.organizationId)
      .run();
    const other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES(?,'sponsor-brand-other','Other sponsor view','UTC','invitation_only',?,?)",
    )
      .bind(other, nowIso(), nowIso())
      .run();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'Leader','active',?,?)",
    )
      .bind(crypto.randomUUID(), f.organizationId, other, nowIso(), nowIso())
      .run();
    f.selections.push({ eventSlug: "sponsor-brand-other" });
    const before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    expect(await projection(f)).not.toEqual(before);
    expect(await requests()).toHaveLength(1);
  });
  it("checks the default consortium view even when the event tier has zero display weight", async () => {
    const f = await fixture("event");
    await env.DB.prepare("UPDATE organizations SET sponsor_tier='Gold' WHERE id=?").bind(f.organizationId).run();
    const [tier] = await queryAll<{ display_weight: number }>(
      env.DB,
      "SELECT display_weight FROM sponsorship_tier_catalog WHERE sponsor_type='event' AND tier='Leader'",
    );
    try {
      await env.DB.prepare(
        "UPDATE sponsorship_tier_catalog SET display_weight=0 WHERE sponsor_type='event' AND tier='Leader'",
      ).run();
      f.selections.push({});
      const before = await projection(f);
      expect((await change(f, "name")).status).toBe(200);
      expect(await projection(f)).not.toEqual(before);
      expect(await requests()).toHaveLength(1);
    } finally {
      await env.DB.prepare(
        "UPDATE sponsorship_tier_catalog SET display_weight=? WHERE sponsor_type='event' AND tier='Leader'",
      )
        .bind(tier!.display_weight)
        .run();
    }
  });
  it("keeps a non-member sponsorship with a colliding id separate from an unlisted organization", async () => {
    const f = await fixture("consortium", false);
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,non_member_name,tier,pipeline_stage,created_at,updated_at) VALUES(?,'consortium','Independent public sponsor','Gold','active',?,?)",
    )
      .bind(f.organizationId, nowIso(), nowIso())
      .run();
    const before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    expect(await projection(f)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it("publishes sponsor branding without any Member aggregate", async () => {
    const f = await fixture("consortium", true, false),
      before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    expect(await projection(f)).not.toEqual(before);
    expect(await requests()).toHaveLength(1);
  });
  it.each([
    { name: "Sponsor branding organization" },
    { website: null },
    { description: "Private to this sponsor display" },
  ])("keeps unchanged or unused sponsor fields quiet: %j", async (changes) => {
    const f = await fixture(),
      before = await projection(f);
    expect((await patch(f, changes)).status).toBe(200);
    expect(await projection(f)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it("keeps a no-op sponsor website approval quiet", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE organizations SET website='https://approved.example.test/' WHERE id=?")
      .bind(f.organizationId)
      .run();
    const before = await projection(f);
    expect((await review(f)).status).toBe(200);
    expect(await projection(f)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it("keeps one intent when active Member and sponsor branding overlap", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE members SET status='active' WHERE id=?").bind(f.memberId).run();
    expect((await change(f, "name")).status).toBe(200);
    expect(await requests()).toHaveLength(1);
  });
  it("publishes sponsor logo removal once and resolves its selected public asset", async () => {
    const f = await fixture();
    expect((await logo(f)).status).toBe(200);
    const snapshot = await readSitePublicationSnapshot(env.DB, f.selections),
      refs = publishedMediaReferences(snapshot);
    const key = await env.DB.prepare("SELECT logo_r2_key FROM organizations WHERE id=?")
      .bind(f.organizationId)
      .first<string>("logo_r2_key");
    const path = `/api/v1/members/${f.organizationId}/logo`;
    expect(refs).toEqual([path, versionedImagePath(path, key)!].sort());
    const keys = await resolvePublishedMediaKeys(env.DB, refs);
    expect([...new Set(Object.values(keys))]).toEqual([key]);
    expect(await env.ASSETS_BUCKET!.get(key!)).not.toBeNull();
    for (const reference of refs) {
      const image = await callApi(env, reference);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toContain("image/");
    }
    expect((await logo(f, "DELETE")).status).toBe(200);
    expect(await requests()).toHaveLength(2);
    expect(publishedMediaReferences(await readSitePublicationSnapshot(env.DB, f.selections))).toEqual([]);
    expect((await logo(f, "DELETE")).status).toBe(200);
    expect(await requests()).toHaveLength(2);
  });
  it.each(
    ["profile", "logo", "review"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back sponsor-only branding and retries: %j", async ({ operation, failure }) => {
    const f = await fixture();
    if (operation === "logo") expect((await logo(f)).status).toBe(200);
    const reviewId = operation === "review" ? await stageReview(f, true) : null;
    const state = () =>
      queryAll(env.DB, "SELECT name,website,logo_r2_key,logo_staging_r2_key,updated_at FROM organizations WHERE id=?", [
        f.organizationId,
      ]);
    const beforeState = await state(),
      before = await projection(f),
      recorded = await requests();
    const objects = (await env.ASSETS_BUCKET!.list({ prefix: `org-logos/${f.organizationId}/` })).objects
      .map((row) => row.key)
      .sort();
    const action =
      operation === "profile"
        ? "organization_updated"
        : operation === "logo"
          ? "organization_logo_uploaded"
          : "organization_content_review_approved";
    await env.DB.prepare(
      failure === "request"
        ? "CREATE TRIGGER fail_sponsor_branding BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SPONSOR_BRANDING_FAILURE'); END"
        : `CREATE TRIGGER fail_sponsor_branding BEFORE INSERT ON audit_log WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SPONSOR_BRANDING_FAILURE'); END`,
    ).run();
    const attempt = () =>
      operation === "profile" ? change(f, "name") : operation === "logo" ? logo(f) : approve(reviewId!);
    try {
      expect((await attempt()).status).toBe(500);
      expect(await state()).toEqual(beforeState);
      expect(await projection(f)).toEqual(before);
      expect(await requests()).toEqual(recorded);
      expect(
        (await env.ASSETS_BUCKET!.list({ prefix: `org-logos/${f.organizationId}/` })).objects
          .map((row) => row.key)
          .sort(),
      ).toEqual(objects);
      if (reviewId)
        expect(
          await queryAll(env.DB, "SELECT status FROM organization_content_reviews WHERE id=?", [reviewId]),
        ).toEqual([{ status: "pending" }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_sponsor_branding").run();
    }
    expect((await attempt()).status).toBe(200);
    expect(await requests()).toHaveLength(recorded.length + 1);
    expect(await projection(f)).not.toEqual(before);
  });
  it("uses committing sponsor visibility after a withdrawal race", async () => {
    const f = await fixture("event"),
      revision = (await env.DB.prepare("SELECT updated_at FROM organizations WHERE id=?")
        .bind(f.organizationId)
        .first<string>("updated_at"))!;
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE organization_id=?")
        .bind(f.organizationId)
        .run(),
    );
    await updateOrganization(raced, actor, f.organizationId, { revision, name: "After sponsor withdrawal" });
    expect(await requests()).toEqual([]);
  });

  it.each(["name", "website", "logo", "review"])(
    "publishes a nonactive Member sponsor change through %s",
    async (operation) => {
      const f = await fixture(),
        before = await projection(f);
      expect((await change(f, operation)).status).toBe(200);
      expect(await projection(f)).not.toEqual(before);
      expect(await requests()).toEqual([
        expect.objectContaining({ resource_type: "organization_content", resource_id: f.organizationId }),
      ]);
    },
  );
  it("publishes the selected event sponsor website without an active Member", async () => {
    const f = await fixture("event"),
      before = await projection(f);
    expect((await change(f, "website")).status).toBe(200);
    expect(await projection(f)).not.toEqual(before);
    expect(await requests()).toHaveLength(1);
  });
  it("keeps an unlisted consortium tier quiet", async () => {
    const f = await fixture("consortium", false),
      before = await projection(f);
    expect((await change(f, "name")).status).toBe(200);
    expect(await projection(f)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
});
