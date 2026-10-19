import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { SitePublicationSnapshot } from "../assets/shared/schemas/site-publication";
import { publishedPersonProfile } from "../functions/_lib/services/site-person-profile";
import type { DatabaseLike } from "../functions/_lib/types";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedPersonPages } from "../functions/_lib/services/site-session-history";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const { admin } = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, admin.id, "profile-publication-admin");
});

async function contributor(
  options: {
    addressed?: boolean;
    hidden?: boolean;
    organization?: boolean;
    activeMember?: boolean;
    pastPersonal?: boolean;
  } = {},
) {
  const person = await insertIndividualMember(env.DB, "H6", "profile-publication@example.test");
  if (options.addressed !== false) {
    await insertGroupSeat("profile-publication", { publicRoster: true }, person);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  let identityId = person.identityId;
  if (options.organization) {
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Contributor Organization"),
    );
    identityId = await addRepresentative(env.DB, memberId, person.userId, {
      jobTitle: "Engineer",
      showOnOrgProfile: false,
    });
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
  }
  if (!options.activeMember)
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  if (options.hidden)
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(identityId).run();
  if (options.pastPersonal)
    await env.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,source,show_on_organization_profile,invited_at,started_at,ended_at,created_at,updated_at)
    VALUES (?, ?, NULL, 'staff', 0, '2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','2021-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','2021-01-01T00:00:00.000Z')`)
      .bind(crypto.randomUUID(), person.userId)
      .run();
  const owner = await createMemberSession(
    env.DB,
    person.userId,
    "profile-publication-owner",
    undefined,
    person.identityId,
  );
  return { ...person, identityId, owner };
}

function patch(token: string, path: string, body: unknown, db: DatabaseLike = env.DB) {
  return callApi({ ...env, DB: db }, path, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id FROM site_publication_requests ORDER BY sequence");
const identityRequests = () =>
  queryAll(
    env.DB,
    "SELECT resource_id,reason_code FROM site_publication_requests WHERE resource_type='identity_profile'",
  );

function publicProfile(publication: SitePublicationSnapshot, userId: string) {
  const page = publishedPersonPages(publication).find((person) => person.userId === userId);
  return page ? publishedPersonProfile(publication, page) : undefined;
}

describe("publication after person profile edits", () => {
  it.each([
    {
      mode: "owner",
      hidden: false,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "biography",
      changed: true,
    },
    {
      mode: "staff",
      hidden: false,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "links",
      changed: true,
    },
    {
      mode: "owner",
      hidden: false,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "title",
      changed: true,
    },
    {
      mode: "staff",
      hidden: true,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "biography",
      changed: false,
    },
    {
      mode: "staff",
      hidden: false,
      addressed: false,
      organization: false,
      activeMember: false,
      field: "biography",
      changed: false,
    },
    {
      mode: "owner",
      hidden: false,
      addressed: true,
      organization: true,
      activeMember: false,
      field: "title",
      changed: true,
    },
    {
      mode: "owner",
      hidden: false,
      addressed: true,
      organization: false,
      activeMember: true,
      field: "biography",
      changed: true,
    },
    {
      mode: "staff",
      hidden: true,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "title",
      changed: false,
    },
    {
      mode: "staff",
      hidden: true,
      addressed: true,
      organization: false,
      activeMember: false,
      field: "title",
      pastPersonal: true,
      changed: true,
    },
  ])("queues changed public identity projections: %j", async (options) => {
    const person = await contributor(options);
    const before = await readSitePublicationSnapshot(env.DB, []);
    const body =
      options.field === "title"
        ? { jobTitle: "Published researcher" }
        : options.field === "links"
          ? { links: ["https://example.test/contributor"] }
          : { biography: "Public contributor biography" };
    const path =
      options.mode === "owner"
        ? `/api/v1/users/current/identities/${person.identityId}/profile`
        : `/api/v1/identities/${person.identityId}`;
    const attempt = () => patch(options.mode === "owner" ? person.owner : staff, path, body);
    const response = await attempt();
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await readSitePublicationSnapshot(env.DB, []);
    if (options.changed) expect(publicProfile(after, person.userId)).not.toEqual(publicProfile(before, person.userId));
    else expect(publicProfile(after, person.userId)).toEqual(publicProfile(before, person.userId));
    expect(await identityRequests()).toEqual(
      options.changed ? [{ resource_id: person.identityId, reason_code: "identity_profile_changed" }] : [],
    );
    expect((await attempt()).status).toBe(200);
    expect(await identityRequests()).toHaveLength(options.changed ? 1 : 0);
  });

  it.each([
    { mode: "owner", addressed: true, preferred: false },
    { mode: "owner", addressed: true, preferred: true },
    { mode: "staff", addressed: true, preferred: false },
    { mode: "staff", addressed: true, preferred: true },
    { mode: "owner", addressed: false, preferred: false },
    { mode: "staff", addressed: false, preferred: true },
  ])("publishes names for addressed nonmembers: %j", async (options) => {
    const person = await contributor(options);
    const before = await requests();
    const body = options.preferred
      ? { preferredName: "Preferred contributor" }
      : { firstName: "Public", lastName: "Contributor" };
    const attempt = () =>
      patch(
        options.mode === "owner" ? person.owner : staff,
        options.mode === "owner" ? "/api/v1/users/current" : `/api/v1/users/${person.userId}`,
        body,
      );
    const response = await attempt();
    expect(response.status, await response.clone().text()).toBe(200);
    const publication = await readSitePublicationSnapshot(env.DB, []);
    if (options.addressed)
      expect(publishedPersonPages(publication).find((page) => page.userId === person.userId)?.name).toBe(
        options.preferred ? "Preferred contributor" : "Public Contributor",
      );
    else expect(publication.people?.[person.userId]).toBeUndefined();
    expect(await requests()).toHaveLength(before.length + (options.addressed ? 1 : 0));
    expect((await attempt()).status).toBe(200);
    expect(await requests()).toHaveLength(before.length + (options.addressed ? 1 : 0));
  });

  it("publishes clearing a preferred name while keeping the contributor address stable", async () => {
    const person = await contributor();
    await env.DB.prepare("UPDATE users SET preferred_name='Former name' WHERE id=?").bind(person.userId).run();
    const before = publicProfile(await readSitePublicationSnapshot(env.DB, []), person.userId);
    expect(before?.name).toBe("Former name");
    const beforeRequests = await requests();
    const response = await patch(staff, `/api/v1/users/${person.userId}`, { preferredName: null });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(publicProfile(await readSitePublicationSnapshot(env.DB, []), person.userId)).toMatchObject({
      name: "Test",
      route: before?.route,
    });
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });

  it.each([
    { kind: "identity", failure: "request" },
    { kind: "identity", failure: "audit" },
    { kind: "name", failure: "request" },
    { kind: "name", failure: "audit" },
  ])("rolls back public profile edits and retries: %j", async ({ kind, failure }) => {
    const person = await contributor();
    const before = await readSitePublicationSnapshot(env.DB, []);
    const beforeRequests = await requests();
    const resourceType = kind === "identity" ? "identity_profile" : "user_profile";
    const action = kind === "identity" ? "identity_profile_updated" : "profile_names_updated";
    const attempt = () =>
      patch(
        person.owner,
        kind === "identity" ? `/api/v1/users/current/identities/${person.identityId}/profile` : "/api/v1/users/current",
        kind === "identity" ? { biography: "Published biography" } : { preferredName: "Published name" },
      );
    await env.DB.prepare(`CREATE TRIGGER fail_person_profile BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      WHEN ${failure === "request" ? `NEW.resource_type='${resourceType}'` : `NEW.action='${action}'`}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_PROFILE_FAILURE'); END`).run();
    try {
      expect((await attempt()).status).toBe(500);
      expect((await readSitePublicationSnapshot(env.DB, [])).people).toEqual(before.people);
      expect(await requests()).toEqual(beforeRequests);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=?", [action])).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_person_profile").run();
    }
    const response = await attempt();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
    expect((await readSitePublicationSnapshot(env.DB, [])).people).not.toEqual(before.people);
  });

  it("leaves no losing profile request when another identity edit wins", async () => {
    const person = await contributor();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("UPDATE identities") && sql.includes("email_id = CASE"),
      () =>
        env.DB.prepare(
          "UPDATE identities SET biography='Winning biography',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?",
        )
          .bind(person.identityId)
          .run(),
    );
    const response = await patch(
      person.owner,
      `/api/v1/users/current/identities/${person.identityId}/profile`,
      { biography: "Losing biography" },
      db,
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(person.identityId).first("biography"),
    ).toBe("Winning biography");
    expect(await identityRequests()).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_profile_updated'")).toEqual([]);
  });
});
