/**
 * A person's professional profile through the mounted router: what its owner
 * sees, what everybody else sees, and the staff decision that withholds an
 * identity from the public profile.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { DatabaseLike } from "../functions/_lib/types";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { setIdentityPublicProfileHidden } from "../functions/_lib/services/identities/public-profile-visibility";
import { callApi } from "./helpers/app";
import { personProfileResponseSchema } from "../assets/shared/schemas/person-profile";
import { myProfileSchema } from "../assets/shared/schemas/me";
import {
  identityPublicProfileSchema,
  identityPublicProfileUpdateSchema,
  identityRecordSchema,
} from "../assets/shared/schemas/identity-public-profile";
import { readPublishedPeople } from "../functions/_lib/services/people/published-person";
import { identityProfileUpdateSchema, ownIdentityProfileSchema } from "../assets/shared/schemas/own-identity-profile";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedPersonPages } from "../functions/_lib/services/site-session-history";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertOrgRepresentative,
  seedOrganizationAggregate,
  insertUser,
} from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

const NOW = () => new Date().toISOString();

function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, new Request(`https://app.test${path}`, { ...init, headers }));
}

async function profileOf(token: string, userId: string) {
  const response = await call(token, `/api/v1/users/${userId}/profile`);
  expect(response.status, await response.clone().text()).toBe(200);
  return personProfileResponseSchema.parse(await response.json());
}

async function createStaffSession(permissions: string[]): Promise<string> {
  const staffId = await insertUser(env.DB, `staff-${crypto.randomUUID()}@example.test`);
  for (const permission of permissions)
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
    )
      .bind(crypto.randomUUID(), staffId, permission, staffId, NOW())
      .run();
  return createAdminSession(env.DB, staffId, `staff-${crypto.randomUUID()}`);
}

describe("person profile", () => {
  beforeEach(resetDb);

  it("shows every identity publicly until staff hide it, and then only to its owner, marked", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner@example.test");
    const reader = await insertIndividualMember(env.DB, "H6", "reader@example.test");
    const ownerToken = await createMemberSession(env.DB, owner.userId, "owner-token");
    const readerToken = await createMemberSession(env.DB, reader.userId, "reader-token");
    const staffToken = await createStaffSession(["membership:read", "membership:write"]);

    const before = await profileOf(readerToken, owner.userId);
    expect(before.audience).toBe("public");
    expect(before.profile.identities.map((identity) => [identity.id, identity.visibility])).toEqual([
      [owner.identityId, "public"],
    ]);
    // An identity alone never earns a page.
    expect(before.profile.route).toBeNull();

    // Hiding is never the person's own choice.
    const refused = await call(ownerToken, `/api/v1/identities/${owner.identityId}`, {
      method: "PATCH",
      body: JSON.stringify(identityPublicProfileUpdateSchema.parse({ hiddenFromPublicProfile: true })),
    });
    expect([401, 403]).toContain(refused.status);

    const hidden = await call(staffToken, `/api/v1/identities/${owner.identityId}`, {
      method: "PATCH",
      body: JSON.stringify(identityPublicProfileUpdateSchema.parse({ hiddenFromPublicProfile: true })),
    });
    expect(hidden.status, await hidden.clone().text()).toBe(200);
    expect(identityPublicProfileSchema.parse(await hidden.json()).hiddenFromPublicProfile).toBe(true);
    const audit = await env.DB.prepare("SELECT action, entity_id FROM audit_log WHERE entity_type = 'identity'").all();
    expect(audit.results).toEqual([{ action: "identity_public_profile_hidden", entity_id: owner.identityId }]);

    expect((await profileOf(readerToken, owner.userId)).profile.identities).toEqual([]);
    const own = await profileOf(ownerToken, owner.userId);
    expect(own.profile.identities.map((identity) => [identity.id, identity.visibility])).toEqual([
      [owner.identityId, "hidden"],
    ]);

    const shown = await call(staffToken, `/api/v1/identities/${owner.identityId}`, {
      method: "PATCH",
      body: JSON.stringify(identityPublicProfileUpdateSchema.parse({ hiddenFromPublicProfile: false })),
    });
    expect(shown.status).toBe(200);
    expect((await profileOf(readerToken, owner.userId)).profile.identities).toHaveLength(1);
  });

  it("lets staff with membership:write edit an identity's profile through the owner's contract, audited", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "edited@example.test");
    const ownerToken = await createMemberSession(env.DB, owner.userId, "edited-owner-token");
    const readerToken = await createStaffSession(["membership:read"]);
    const staffToken = await createStaffSession(["membership:read", "membership:write"]);
    const path = `/api/v1/identities/${owner.identityId}`;
    const edit = identityProfileUpdateSchema.parse({
      jobTitle: "Independent researcher",
      biography: "Edited by staff.",
      links: ["https://example.test/edited"],
    });

    for (const token of [ownerToken, readerToken]) {
      const refused = await call(token, path, { method: "PATCH", body: JSON.stringify(edit) });
      expect([401, 403]).toContain(refused.status);
    }
    const mixed = await call(staffToken, path, {
      method: "PATCH",
      body: JSON.stringify({ ...edit, hiddenFromPublicProfile: true }),
    });
    expect(mixed.status).toBe(400);

    expect((await env.DB.prepare("SELECT id FROM site_publication_requests").all()).results).toHaveLength(0);
    const saved = await call(staffToken, path, { method: "PATCH", body: JSON.stringify(edit) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(identityRecordSchema.parse(await saved.json())).toMatchObject({
      identityId: owner.identityId,
      organizationId: null,
      jobTitle: "Independent researcher",
      biography: "Edited by staff.",
      links: ["https://example.test/edited"],
      hiddenFromPublicProfile: false,
    });
    expect((await env.DB.prepare("SELECT resource_id FROM site_publication_requests").all()).results).toEqual([
      { resource_id: owner.identityId },
    ]);
    const read = await call(readerToken, path);
    expect(identityRecordSchema.parse(await read.json()).biography).toBe("Edited by staff.");
    const audit = await env.DB.prepare(
      "SELECT action, actor_type, details_json FROM audit_log WHERE entity_type = 'identity' AND entity_id = ?",
    )
      .bind(owner.identityId)
      .all<{ action: string; actor_type: string; details_json: string }>();
    expect(audit.results.map((row) => [row.action, row.actor_type])).toEqual([["identity_profile_updated", "admin"]]);
    expect(JSON.parse(audit.results[0].details_json)).toMatchObject({
      biography: { to: "Edited by staff." },
      jobTitle: { to: "Independent researcher" },
    });
  });

  it("queues changed individual member bios and links, but not titles or inactive memberships", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "member-publication@example.test");
    const token = await createStaffSession(["membership:read", "membership:write"]);
    const path = `/api/v1/identities/${owner.identityId}`;
    const save = async (body: unknown) => {
      const response = await call(token, path, { method: "PATCH", body: JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const requests = () => env.DB.prepare("SELECT resource_id,reason_code FROM site_publication_requests").all();
    await save({ jobTitle: "Independent researcher" });
    expect((await requests()).results).toHaveLength(0);
    await save({ biography: "Published biography", links: ["https://example.test/profile"] });
    expect((await requests()).results).toEqual([
      { resource_id: owner.identityId, reason_code: "identity_profile_changed" },
    ]);
    await save({ biography: "Published biography", links: ["https://example.test/profile"] });
    expect((await requests()).results).toHaveLength(1);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(owner.memberId).run();
    await save({ biography: "Private membership change" });
    expect((await requests()).results).toHaveLength(1);
  });

  it("lists a seat only in a group that publishes its roster", async () => {
    const person = await insertIndividualMember(env.DB, "H6", "seat@example.test");
    await insertGroupSeat("published", { publicRoster: true }, person);
    await insertGroupSeat("private", { publicRoster: false }, person);

    const people = await readPublishedPeople(env.DB, [person.userId], "public");

    expect(people[person.userId]?.groups.map((role) => [role.groupSlug, role.title, role.endsAt])).toEqual([
      ["published", "Member", null],
    ]);
  });

  it("edits a held identity other than the acting one, audited, without switching the acting identity", async () => {
    const acting = await insertOrgRepresentative(env.DB, { email: "two-identities@example.test" });
    const person = { userId: acting.userId, identityId: acting.identityId };
    const memberId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB, "Example Org"));
    const organizationIdentityId = await addRepresentative(env.DB, memberId, person.userId);
    const token = await createMemberSession(
      env.DB,
      person.userId,
      "two-identities-token",
      undefined,
      person.identityId,
    );
    const path = `/api/v1/users/current/identities/${organizationIdentityId}/profile`;

    const before = await call(token, path);
    expect(before.status, await before.clone().text()).toBe(200);
    expect(ownIdentityProfileSchema.parse(await before.json())).toMatchObject({ organizationName: "Example Org" });

    const saved = await call(token, path, {
      method: "PATCH",
      body: JSON.stringify(
        identityProfileUpdateSchema.parse({
          jobTitle: "Chair",
          biography: "Leads the working group.",
          links: ["https://example.com/chair"],
        }),
      ),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(ownIdentityProfileSchema.parse(await saved.json())).toMatchObject({ jobTitle: "Chair" });

    const audit = await env.DB.prepare(
      "SELECT entity_id, details_json FROM audit_log WHERE action = 'identity_profile_updated'",
    ).all<{ entity_id: string; details_json: string }>();
    expect(audit.results.map((row) => row.entity_id)).toEqual([organizationIdentityId]);
    expect(JSON.parse(audit.results[0]!.details_json)).toMatchObject({ jobTitle: { from: null, to: "Chair" } });

    // The session still acts as the identity it did.
    const current = await call(token, "/api/v1/users/current");
    expect(myProfileSchema.parse(await current.json()).identityId).toBe(person.identityId);

    const own = await profileOf(token, person.userId);
    expect(own.profile.identities.find((identity) => identity.id === organizationIdentityId)).toMatchObject({
      title: "Chair",
      visibility: "public",
    });
  });

  it("refuses an identity the caller does not hold", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "holder@example.test");
    const other = await insertIndividualMember(env.DB, "H6", "other@example.test");
    const token = await createMemberSession(env.DB, other.userId, "other-token");
    const response = await call(token, `/api/v1/users/current/identities/${owner.identityId}/profile`, {
      method: "PATCH",
      body: JSON.stringify(identityProfileUpdateSchema.parse({ jobTitle: "Taken over" })),
    });
    expect(response.status).toBe(404);
  });

  it("issues a public contributor's address on schedule, never for an identity alone, and publishes no hidden identity", async () => {
    await insertIndividualMember(env.DB, "H6", "identity-only@example.test");
    const seated = await insertIndividualMember(env.DB, "H6", "seated@example.test");
    const alsoSeated = await insertIndividualMember(env.DB, "H6", "also-seated@example.test");
    const unseen = await insertIndividualMember(env.DB, "H6", "unseen@example.test");
    await insertGroupSeat("published", { publicRoster: true }, seated);
    await insertGroupSeat("also-published", { publicRoster: true }, alsoSeated);
    await insertGroupSeat("private", { publicRoster: false }, unseen);
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile = 1 WHERE id = ?")
      .bind(alsoSeated.identityId)
      .run();

    expect(publishedPersonPages(await readSitePublicationSnapshot(env.DB, []))).toEqual([]);
    expect(await issueContributorProfileAddresses(env.DB, NOW(), 50)).toEqual({ examined: 2, issued: 2 });
    const requests = await queryAll<{ resource_id: string; reason_code: string }>(
      env.DB,
      "SELECT resource_id,reason_code FROM site_publication_requests ORDER BY resource_id",
    );
    expect(requests).toEqual(
      [seated.userId, alsoSeated.userId]
        .sort()
        .map((resource_id) => ({ resource_id, reason_code: "user_profile_changed" })),
    );
    expect(await issueContributorProfileAddresses(env.DB, NOW(), 50)).toEqual({ examined: 0, issued: 0 });
    expect(
      await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests ORDER BY resource_id"),
    ).toEqual(requests);
    const addresses = await env.DB.prepare(
      "SELECT user_id, slug FROM person_profile_slugs WHERE retired_at IS NULL ORDER BY slug",
    ).all<{ user_id: string; slug: string }>();
    expect(addresses.results.map((row) => row.slug)).toEqual(["test", "test-2"]);
    expect(addresses.results.map((row) => row.user_id).sort()).toEqual([seated.userId, alsoSeated.userId].sort());

    const publication = await readSitePublicationSnapshot(env.DB, []);
    expect(publication.people?.[seated.userId]?.identities.map((identity) => identity.id)).toEqual([seated.identityId]);
    expect(publication.people?.[alsoSeated.userId]?.identities).toEqual([]);
    expect(
      publishedPersonPages(publication)
        .map((page) => page.route)
        .sort(),
    ).toEqual(["/people/test-2/", "/people/test/"]);
  });

  it.each([false, true])(
    "rolls back contributor address issuance and restoration on failure (former=%s)",
    async (former) => {
      const person = await insertIndividualMember(env.DB, "H6", "issuance-rollback@example.test");
      await insertGroupSeat("issuance-public", { publicRoster: true }, person);
      if (former)
        await env.DB.prepare(`INSERT INTO person_profile_slugs(slug,user_id,created_at,retired_at)
      VALUES ('test',?,'2024-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')`)
          .bind(person.userId)
          .run();
      const beforeAddresses = await queryAll(env.DB, "SELECT slug,retired_at FROM person_profile_slugs");
      await env.DB.prepare(`CREATE TRIGGER fail_contributor_request BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CONTRIBUTOR_REQUEST_FAILURE'); END`).run();
      try {
        await expect(issueContributorProfileAddresses(env.DB, NOW(), 50)).rejects.toThrow(
          "SYNTHETIC_CONTRIBUTOR_REQUEST_FAILURE",
        );
        expect(await queryAll(env.DB, "SELECT slug,retired_at FROM person_profile_slugs")).toEqual(beforeAddresses);
        expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
        expect(publishedPersonPages(await readSitePublicationSnapshot(env.DB, []))).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_contributor_request").run();
      }
      expect(await issueContributorProfileAddresses(env.DB, NOW(), 50)).toEqual({ examined: 1, issued: 1 });
      expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual([
        { resource_id: person.userId },
      ]);
      expect(publishedPersonPages(await readSitePublicationSnapshot(env.DB, [])).map((page) => page.route)).toEqual([
        "/people/test/",
      ]);
    },
  );

  it("leaves no publication request when another writer issues the address first", async () => {
    const person = await insertIndividualMember(env.DB, "H6", "issuance-race@example.test");
    await insertGroupSeat("issuance-race", { publicRoster: true }, person);
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      async batch(statements) {
        await env.DB.prepare(
          "INSERT INTO person_profile_slugs(slug,user_id,created_at,retired_at) VALUES ('winner',?,?,NULL)",
        )
          .bind(person.userId, NOW())
          .run();
        return env.DB.batch(statements as D1PreparedStatement[]);
      },
    };
    expect(await issueContributorProfileAddresses(db, NOW(), 50)).toEqual({ examined: 1, issued: 0 });
    expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs")).toEqual([{ slug: "winner" }]);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
  });

  it.each([
    { addressed: true, ended: false, blocked: false, hidden: false },
    { addressed: true, ended: false, blocked: false, hidden: true },
    { addressed: true, ended: true, blocked: false, hidden: false },
    { addressed: false, ended: false, blocked: false, hidden: false },
    { addressed: true, ended: true, blocked: true, hidden: false },
  ])(
    "publishes staff identity visibility changes for profile address holders: %j",
    async ({ addressed, ended, blocked, hidden }) => {
      const person = await insertIndividualMember(env.DB, "H6", "visibility-publication@example.test");
      if (addressed) {
        await insertGroupSeat("visibility-publication", { publicRoster: true }, person);
        await issueContributorProfileAddresses(env.DB, NOW(), 50);
      }
      if (ended)
        await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(NOW(), person.identityId).run();
      if (blocked)
        await env.DB.prepare("UPDATE identities SET blocked_at=? WHERE id=?").bind(NOW(), person.identityId).run();
      if (hidden)
        await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?")
          .bind(person.identityId)
          .run();
      const staff = await createStaffSession(["membership:write"]);
      const before = await readSitePublicationSnapshot(env.DB, []);
      const attempt = () =>
        call(staff, `/api/v1/identities/${person.identityId}`, {
          method: "PATCH",
          body: JSON.stringify(identityPublicProfileUpdateSchema.parse({ hiddenFromPublicProfile: !hidden })),
        });
      const response = await attempt();
      expect(response.status, await response.clone().text()).toBe(200);
      const after = await readSitePublicationSnapshot(env.DB, []);
      const changed = addressed && !blocked;
      if (changed) expect(after.people?.[person.userId]).not.toEqual(before.people?.[person.userId]);
      else expect(after.people?.[person.userId]).toEqual(before.people?.[person.userId]);
      const readRequests = () =>
        queryAll(
          env.DB,
          "SELECT resource_id,reason_code FROM site_publication_requests WHERE resource_type='identity_profile'",
        );
      expect(await readRequests()).toEqual(
        changed ? [{ resource_id: person.identityId, reason_code: "identity_profile_changed" }] : [],
      );
      expect((await attempt()).status).toBe(200);
      expect(await readRequests()).toHaveLength(changed ? 1 : 0);
    },
  );

  it.each(["request", "audit"])(
    "rolls back staff person visibility after %s failure and permits retry",
    async (failure) => {
      const person = await insertIndividualMember(env.DB, "H6", "visibility-rollback@example.test");
      await insertGroupSeat("visibility-rollback", { publicRoster: true }, person);
      await issueContributorProfileAddresses(env.DB, NOW(), 50);
      const staff = await createStaffSession(["membership:write"]);
      const before = await readSitePublicationSnapshot(env.DB, []);
      await env.DB.prepare(`CREATE TRIGGER fail_visibility_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      WHEN ${failure === "request" ? "NEW.resource_type='identity_profile'" : "NEW.action='identity_public_profile_hidden'"}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_VISIBILITY_FAILURE'); END`).run();
      const attempt = () =>
        call(staff, `/api/v1/identities/${person.identityId}`, {
          method: "PATCH",
          body: JSON.stringify({ hiddenFromPublicProfile: true }),
        });
      try {
        expect((await attempt()).status).toBe(500);
        expect((await readSitePublicationSnapshot(env.DB, [])).people).toEqual(before.people);
        expect(
          await queryAll(env.DB, "SELECT hidden_from_public_profile FROM identities WHERE id=?", [person.identityId]),
        ).toEqual([{ hidden_from_public_profile: 0 }]);
        expect(
          await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_public_profile_hidden'"),
        ).toEqual([]);
        expect(
          await queryAll(env.DB, "SELECT id FROM site_publication_requests WHERE resource_type='identity_profile'"),
        ).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_visibility_publication").run();
      }
      expect((await attempt()).status).toBe(200);
      expect((await readSitePublicationSnapshot(env.DB, [])).people?.[person.userId]?.identities).toEqual([]);
      expect(
        await queryAll(
          env.DB,
          "SELECT resource_id FROM site_publication_requests WHERE resource_type='identity_profile'",
        ),
      ).toEqual([{ resource_id: person.identityId }]);
    },
  );

  it("leaves no visibility audit or publication request when a concurrent identity edit wins", async () => {
    const person = await insertIndividualMember(env.DB, "H6", "visibility-race@example.test");
    await insertGroupSeat("visibility-race", { publicRoster: true }, person);
    await issueContributorProfileAddresses(env.DB, NOW(), 50);
    const { admin } = await seedEventAndAdmin(env.DB);
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE identities SET biography='Winning edit',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?")
        .bind(person.identityId)
        .run(),
    );
    await expect(setIdentityPublicProfileHidden(db, admin, person.identityId, true)).rejects.toMatchObject({
      status: 409,
      code: "IDENTITY_CHANGED",
    });
    expect(
      await queryAll(env.DB, "SELECT biography,hidden_from_public_profile FROM identities WHERE id=?", [
        person.identityId,
      ]),
    ).toEqual([{ biography: "Winning edit", hidden_from_public_profile: 0 }]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_public_profile_hidden'")).toEqual(
      [],
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM site_publication_requests WHERE resource_type='identity_profile'"),
    ).toEqual([]);
  });

  it("refuses an unauthenticated reader", async () => {
    const person = await insertIndividualMember(env.DB, "H6", "anonymous-read@example.test");
    const response = await call(null, `/api/v1/users/${person.userId}/profile`);
    expect([401, 403]).toContain(response.status);
  });
});
