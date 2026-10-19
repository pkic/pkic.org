import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { linkVerifiedAddressToDomainOrganization } from "../functions/_lib/services/identities/email-domain-link";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertIndividualMember, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const { admin } = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, admin.id, "person-identity-staff");
});

async function fixture(addressed = true) {
  const person = await insertIndividualMember(env.DB, "H6", "identity-person@example.test");
  if (addressed) {
    await insertGroupSeat("identity-person", { publicRoster: true }, person);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  const owner = await createMemberSession(env.DB, person.userId, "identity-person-owner", undefined, person.identityId);
  const organizationId = await insertOrganization(env.DB, "Person Lifecycle Organization");
  const path = `/api/v1/organizations/${organizationId}/identities`;
  const command = {
    userReference: "existing_user",
    userId: person.userId,
    jobTitle: "Engineer",
    showOnOrganizationProfile: false,
    activation: { mode: "immediate", reason: "Reviewed activation" },
  };
  return { ...person, owner, organizationId, path, command };
}
function command(path: string, method: string, body: unknown, token = staff) {
  return callApi(env, path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const requests = () =>
  queryAll(
    env.DB,
    "SELECT id,resource_id FROM site_publication_requests WHERE resource_type='identity_profile' ORDER BY sequence",
  );
async function create(f: Awaited<ReturnType<typeof fixture>>, pending = false) {
  const response = await command(f.path, "POST", {
    ...f.command,
    ...(pending ? { activation: { mode: "invitation" } } : {}),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { identityId: string }).identityId;
}
async function transition(f: Awaited<ReturnType<typeof fixture>>, identityId: string, state: string) {
  return command(`${f.path}/${identityId}`, "PATCH", { transition: { state, reason: "Reviewed lifecycle change" } });
}
async function hiddenPublicTerm(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  const memberId = await seedOrganizationAggregate(env.DB, f.organizationId);
  const identityId = await create(f);
  await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(identityId).run();
  await insertGroupSeat(
    "identity-public-term",
    { publicRoster: kind === "seat" },
    { userId: f.userId, identityId, memberId },
  );
  if (kind === "leadership") {
    await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE slug='identity-public-term'").run();
    const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='identity-public-term'").first<string>("id");
    await grantGroupLeadershipCapacity(env.DB, groupId!, f.userId);
  }
  return identityId;
}

describe("publication after organization identity changes on person pages", () => {
  it.each([false, true])(
    "preserves staff-hidden visibility on reviewed successor activation (hidden=%s)",
    async (hidden) => {
      const f = await fixture();
      const predecessor = await create(f);
      await env.DB.prepare(
        "UPDATE identities SET hidden_from_public_profile=?,biography='Continuation biography' WHERE id=?",
      )
        .bind(hidden ? 1 : 0, predecessor)
        .run();
      expect((await transition(f, predecessor, "blocked")).status).toBe(200);
      const beforeRequests = await requests();
      const response = await transition(f, predecessor, "active");
      expect(response.status, await response.clone().text()).toBe(200);
      const { identityId } = (await response.json()) as { identityId: string };
      const profile = await readPublicPersonProfile(f.userId);
      expect(profile?.identities.some((identity) => identity.id === identityId)).toBe(!hidden);
      expect(
        await env.DB.prepare("SELECT hidden_from_public_profile FROM identities WHERE id=?")
          .bind(identityId)
          .first("hidden_from_public_profile"),
      ).toBe(hidden ? 1 : 0);
      expect(await requests()).toHaveLength(beforeRequests.length + (hidden ? 0 : 1));
    },
  );

  it.each([false, true])(
    "copies the committing predecessor visibility in the identity builder (conditional=%s)",
    async (conditional) => {
      const f = await fixture();
      const predecessor = await create(f);
      expect((await transition(f, predecessor, "blocked")).status).toBe(200);
      const db = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(predecessor).run(),
      );
      const prepared = await buildCreateIdentityStatement(db, {
        userId: f.userId,
        organizationId: f.organizationId,
        source: "staff",
        jobTitle: "Engineer",
        biography: "Private continuation biography",
        startImmediately: true,
        predecessorIdentityId: predecessor,
        ...(conditional ? { condition: { sql: "SELECT 1", bindings: [] } } : {}),
      });
      await db.batch([prepared.statement, ...prepared.emailOwnership]);
      expect(
        await env.DB.prepare("SELECT hidden_from_public_profile FROM identities WHERE id=?")
          .bind(prepared.identityId)
          .first("hidden_from_public_profile"),
      ).toBe(1);
      expect(
        (await readPublicPersonProfile(f.userId))?.identities.some((identity) => identity.id === prepared.identityId),
      ).toBe(false);
    },
  );

  it("publishes activation, blocking, successors, ending and reinstatement for a person-only profile", async () => {
    const f = await fixture();
    let before = await readPublicPersonProfile(f.userId);
    let identityId = await create(f, true);
    expect(await readPublicPersonProfile(f.userId)).toEqual(before);
    expect(await requests()).toEqual([]);
    for (const state of ["active", "blocked", "active", "ended", "active"]) {
      const count = (await requests()).length;
      const response = await transition(f, identityId, state);
      expect(response.status, await response.clone().text()).toBe(200);
      const nextId = ((await response.json()) as { identityId: string }).identityId;
      if (state === "active" && count === 2) expect(nextId).not.toBe(identityId);
      identityId = nextId;
      const after = await readPublicPersonProfile(f.userId);
      expect(after).not.toEqual(before);
      expect(await requests()).toHaveLength(count + 1);
      before = after;
    }
  });

  it.each(["unaddressed", "hidden"])(
    "keeps %s organization identity history quiet for person pages",
    async (visibility) => {
      const f = await fixture(visibility !== "unaddressed");
      const identityId = await create(f);
      if (visibility === "hidden")
        await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(identityId).run();
      const before = await readPublicPersonProfile(f.userId);
      const beforeRequests = await requests();
      for (const state of ["ended", "active"]) {
        const response = await transition(f, identityId, state);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await readPublicPersonProfile(f.userId)).toEqual(before);
        expect(await requests()).toEqual(beforeRequests);
      }
    },
  );

  it.each(["seat", "leadership"])("publishes hidden identity public %s term closure and restoration", async (kind) => {
    const f = await fixture();
    const identityId = await hiddenPublicTerm(f, kind);
    let before = await readPublicPersonProfile(f.userId);
    const beforeCount = (await requests()).length;
    for (const [index, state] of ["ended", "active"].entries()) {
      const response = await transition(f, identityId, state);
      expect(response.status, await response.clone().text()).toBe(200);
      const after = await readPublicPersonProfile(f.userId);
      expect(after).not.toEqual(before);
      expect(await requests()).toHaveLength(beforeCount + index + 1);
      before = after;
    }
  });

  it.each(["creation", "activation", "end", "owner_end", "restore_hidden"])(
    "rolls back a person lifecycle %s on request failure and permits retry",
    async (operation) => {
      const f = await fixture();
      let identityId: string | undefined;
      if (operation === "restore_hidden") {
        identityId = await hiddenPublicTerm(f, "seat");
        expect((await transition(f, identityId, "ended")).status).toBe(200);
      } else if (operation !== "creation") identityId = await create(f, operation === "activation");
      const before = await readPublicPersonProfile(f.userId);
      const beforeRequests = await requests();
      const attempt = () =>
        operation === "creation"
          ? command(f.path, "POST", f.command)
          : operation === "owner_end"
            ? command(
                `/api/v1/users/current/identities/${identityId}`,
                "PATCH",
                { transition: { state: "ended" } },
                f.owner,
              )
            : transition(f, identityId!, operation === "end" ? "ended" : "active");
      await env.DB.prepare(
        "CREATE TRIGGER fail_person_identity BEFORE INSERT ON site_publication_requests WHEN NEW.resource_type='identity_profile' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_IDENTITY_FAILURE'); END",
      ).run();
      try {
        expect((await attempt()).status).toBe(500);
        expect(await readPublicPersonProfile(f.userId)).toEqual(before);
        expect(await requests()).toEqual(beforeRequests);
        if (operation === "creation")
          expect(
            await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id=?", [f.organizationId]),
          ).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_person_identity").run();
      }
      const response = await attempt();
      expect(response.status, await response.clone().text()).toBe(operation === "creation" ? 201 : 200);
      expect(await readPublicPersonProfile(f.userId)).not.toEqual(before);
      expect(await requests()).toHaveLength(beforeRequests.length + 1);
    },
  );

  it("publishes a new verified-domain identity on an existing person page and keeps owned reuse quiet", async () => {
    const f = await fixture();
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?").bind(
        at,
        f.userId,
      ),
      env.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,application_id,created_at,updated_at) VALUES (?,'example.test',?,NULL,?,?)",
      ).bind(crypto.randomUUID(), f.organizationId, at, at),
    ]);
    const before = await readPublicPersonProfile(f.userId);
    const linked = await linkVerifiedAddressToDomainOrganization(env.DB, {
      userId: f.userId,
      normalizedEmail: "identity-person@example.test",
    });
    expect(linked?.organizationId).toBe(f.organizationId);
    expect(await readPublicPersonProfile(f.userId)).not.toEqual(before);
    expect(await requests()).toEqual([{ id: expect.any(String), resource_id: linked!.identityId }]);
    await linkVerifiedAddressToDomainOrganization(env.DB, {
      userId: f.userId,
      normalizedEmail: "identity-person@example.test",
    });
    expect(await requests()).toHaveLength(1);
  });
});
