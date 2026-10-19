import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";

import { replaceSponsorshipLogo } from "../functions/_lib/services/sponsorship/logo";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="60" height="60" fill="#175"/></svg>';
let token: string;
let actor: UserBackedAuthAdmin;
beforeEach(async () => {
  await resetDb();
  const id = await insertUser(env.DB, "nonmember-logo-admin@example.test");
  await grantAdministrator(env.DB, id);
  actor = { identityType: "user", id, email: "nonmember-logo-admin@example.test", grants: administratorGrants };
  token = await createAdminSession(env.DB, id, "nonmember-logo-admin");
});
async function fixture(type = "consortium", listed = true, withLogo = false) {
  const id = crypto.randomUUID(),
    eventId = type === "event" ? crypto.randomUUID() : null,
    at = nowIso();
  if (eventId)
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES(?,'nonmember-logo-event','Non-member logo event','UTC','invitation_only',?,?)",
    )
      .bind(eventId, at, at)
      .run();
  const key = withLogo ? `sponsor-logos/${id}/old.svg` : null;
  if (key) await env.ASSETS_BUCKET!.put(key, SVG, { httpMetadata: { contentType: "image/svg+xml" } });
  await env.DB.prepare(`INSERT INTO sponsorships(id,sponsor_type,non_member_name,non_member_logo_r2_key,event_id,tier,pipeline_stage,renewal_date,created_at,updated_at)
    VALUES(?,?,'Public non-member sponsor',?,?,?,?,'2035-12-31',?,?)`)
    .bind(id, type, key, eventId, type === "event" ? "Leader" : "Gold", listed ? "active" : "new_inquiry", at, at)
    .run();
  const selections: Array<Record<string, string | undefined>> = eventId
    ? [{ eventSlug: "nonmember-logo-event" }]
    : [{}];
  return { id, eventId, selections, key };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
async function command(f: Awaited<ReturnType<typeof fixture>>, method: "PUT" | "DELETE" = "PUT", auth = token) {
  const body = new FormData();
  body.append("file", new File([SVG], "sponsor.svg", { type: "image/svg+xml" }));
  return callApi(env, `/api/v1/sponsors/${f.id}/logo`, {
    method,
    headers: { authorization: `Bearer ${auth}` },
    ...(method === "PUT" ? { body } : {}),
  });
}
const snapshot = (f: Awaited<ReturnType<typeof fixture>>) => readSitePublicationSnapshot(env.DB, f.selections);
describe("publication of non-member sponsorship logos", () => {
  it.each(
    ["consortium", "event"].flatMap((type) =>
      ["PUT", "DELETE"].map((method) => ({ type, method: method as "PUT" | "DELETE" })),
    ),
  )("publishes changed selected logo data: %j", async ({ type, method }) => {
    const f = await fixture(type, true, method === "DELETE"),
      before = (await snapshot(f)).sponsors;
    const response = await command(f, method);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await snapshot(f)).sponsors).not.toEqual(before);
    expect(await requests()).toEqual([
      expect.objectContaining({ resource_id: f.id, resource_type: "sponsorship", reason_code: "sponsorship_changed" }),
    ]);
  });
  it("keeps an unlisted sponsorship upload quiet", async () => {
    const f = await fixture("consortium", false),
      before = (await snapshot(f)).sponsors;
    expect((await command(f)).status).toBe(200);
    expect((await snapshot(f)).sponsors).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it.each(["consortium", "event"])("serves selected %s assets and removes the logo once", async (type) => {
    const f = await fixture(type);
    expect((await command(f)).status).toBe(200);
    const refs = publishedMediaReferences(await snapshot(f));
    expect(refs).toHaveLength(type === "consortium" ? 2 : 1);
    const keys = await resolvePublishedMediaKeys(env.DB, refs);
    expect(new Set(Object.values(keys)).size).toBe(1);
    for (const ref of refs) {
      const image = await callApi(env, ref);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toContain("image/");
    }
    expect((await command(f, "DELETE")).status).toBe(200);
    expect(publishedMediaReferences(await snapshot(f))).toEqual([]);
    expect(await requests()).toHaveLength(2);
    expect((await command(f, "DELETE")).status).toBe(200);
    expect(await requests()).toHaveLength(2);
  });
  it.each(["lapsed", "missing-name", "unknown-tier", "inactive-tier", "zero-weight"])(
    "keeps %s out of publication",
    async (mode) => {
      const f = await fixture();
      const [catalog] = await queryAll<{ active: number; display_weight: number }>(
        env.DB,
        "SELECT active,display_weight FROM sponsorship_tier_catalog WHERE sponsor_type='consortium' AND tier='Gold'",
      );
      try {
        if (mode === "lapsed")
          await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE id=?").bind(f.id).run();
        if (mode === "missing-name")
          await env.DB.prepare("UPDATE sponsorships SET non_member_name=NULL WHERE id=?").bind(f.id).run();
        if (mode === "unknown-tier")
          await env.DB.prepare("UPDATE sponsorships SET tier='Unknown' WHERE id=?").bind(f.id).run();
        if (mode === "inactive-tier")
          await env.DB.prepare(
            "UPDATE sponsorship_tier_catalog SET active=0 WHERE sponsor_type='consortium' AND tier='Gold'",
          ).run();
        if (mode === "zero-weight")
          await env.DB.prepare(
            "UPDATE sponsorship_tier_catalog SET display_weight=0 WHERE sponsor_type='consortium' AND tier='Gold'",
          ).run();
        const before = (await snapshot(f)).sponsors;
        expect((await command(f)).status).toBe(200);
        expect((await snapshot(f)).sponsors).toEqual(before);
        expect(await requests()).toEqual([]);
      } finally {
        await env.DB.prepare(
          "UPDATE sponsorship_tier_catalog SET active=?,display_weight=? WHERE sponsor_type='consortium' AND tier='Gold'",
        )
          .bind(catalog!.active, catalog!.display_weight)
          .run();
      }
    },
  );
  it("refuses organization-linked logos without changing their pointer or publication", async () => {
    const f = await fixture();
    const org = await insertOrganization(env.DB);
    await env.DB.prepare("UPDATE sponsorships SET organization_id=? WHERE id=?").bind(org, f.id).run();
    for (const method of ["PUT", "DELETE"] as const) {
      expect((await command(f, method)).status).toBe(422);
      expect(await requests()).toEqual([]);
    }
  });
  it("does not confuse an unrelated public organization with the same id", async () => {
    const f = await fixture("consortium", false),
      at = nowIso();
    await env.DB.prepare(
      "INSERT INTO organizations(id,name,normalized_name,sponsor_tier,created_at,updated_at) VALUES(?,'Other sponsor','other sponsor','Gold',?,?)",
    )
      .bind(f.id, at, at)
      .run();
    const before = (await snapshot(f)).sponsors;
    expect((await command(f)).status).toBe(200);
    expect((await snapshot(f)).sponsors).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it.each(
    ["PUT", "DELETE"].flatMap((method) =>
      ["request", "audit"].map((failure) => ({ method: method as "PUT" | "DELETE", failure })),
    ),
  )("rolls back and retries %j", async ({ method, failure }) => {
    const f = await fixture("consortium", true, true);
    const state = () =>
      queryAll(env.DB, "SELECT non_member_logo_r2_key,updated_at FROM sponsorships WHERE id=?", [f.id]);
    const objects = async () =>
      (await env.ASSETS_BUCKET!.list({ prefix: `sponsor-logos/${f.id}/` })).objects.map((row) => row.key).sort();
    const beforeState = await state(),
      before = (await snapshot(f)).sponsors,
      beforeObjects = await objects();
    const action = method === "PUT" ? "sponsorship_logo_uploaded" : "sponsorship_logo_removed";
    await env.DB.prepare(
      failure === "request"
        ? "CREATE TRIGGER fail_nonmember_logo BEFORE INSERT ON site_publication_requests WHEN NEW.resource_type='sponsorship' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_LOGO_FAILURE'); END"
        : `CREATE TRIGGER fail_nonmember_logo BEFORE INSERT ON audit_log WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_LOGO_FAILURE'); END`,
    ).run();
    try {
      expect((await command(f, method)).status).toBe(500);
      expect(await state()).toEqual(beforeState);
      expect((await snapshot(f)).sponsors).toEqual(before);
      expect(await objects()).toEqual(beforeObjects);
      expect(await requests()).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_nonmember_logo").run();
    }
    expect((await command(f, method)).status).toBe(200);
    expect(await requests()).toHaveLength(1);
    expect((await snapshot(f)).sponsors).not.toEqual(before);
  });
  it("uses sponsor visibility at commit after a concurrent withdrawal", async () => {
    const f = await fixture();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE id=?").bind(f.id).run(),
    );
    await replaceSponsorshipLogo(raced, actor, env.ASSETS_BUCKET!, f.id, {
      buffer: new TextEncoder().encode(SVG).buffer,
      contentType: "image/svg+xml",
    });
    expect(await requests()).toEqual([]);
  });
  it("refuses unauthenticated uploads and removals", async () => {
    const f = await fixture("consortium", true, true);
    for (const method of ["PUT", "DELETE"] as const)
      expect((await command(f, method, "invalid-token")).status).toBe(401);
    expect(await requests()).toEqual([]);
    expect(
      await env.DB.prepare("SELECT non_member_logo_r2_key FROM sponsorships WHERE id=?")
        .bind(f.id)
        .first("non_member_logo_r2_key"),
    ).toBe(f.key);
  });
});
