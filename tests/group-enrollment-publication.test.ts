import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema, type Group } from "../assets/shared/schemas/groups";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import {
  prepareAutomaticGroupEnrollmentForUserStatements,
  reconcileAutomaticGroupEnrollmentForUser,
} from "../functions/_lib/services/groups/automatic-enrollment";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { insertGroupSeat } from "./helpers/person-profile";
import { addRepresentative, insertIndividualMember, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

let token: string;
async function command(path: string, method: string, body: unknown, bearer = token) {
  return callApi(env, `/api/v1/groups${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function createGroup(extra: Record<string, unknown> = {}) {
  const response = await command("", "POST", {
    typeKey: "working_group",
    name: "Enrollment publication",
    slug: "enrollment-publication",
    visibility: "authenticated",
    eligibilityMode: "category",
    automaticEnrollmentMode: "category",
    allowAutomaticOptOut: true,
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return groupSchema.parse(((await response.json()) as { group: unknown }).group);
}
async function fixture(
  options: {
    publicRoster?: boolean;
    publicListing?: boolean;
    organization?: boolean;
    anchor?: boolean;
    automatic?: boolean;
  } = {},
) {
  const group = await createGroup({
    publicRoster: options.publicRoster ?? true,
    visibility: options.publicListing ? "public" : "authenticated",
    automaticEnrollmentMode: options.automatic === false ? "none" : "category",
  });
  const person = options.organization ? await insertOrgRepresentative(env.DB) : await insertIndividualMember(env.DB);
  if (options.anchor !== false) {
    await insertGroupSeat("enrollment-profile-anchor", { publicRoster: true }, person);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  const bearer = await createMemberSession(env.DB, person.userId, "enrollment-publication-member-token");
  return { group, person, bearer, category: options.organization ? "A" : "H6" };
}
function rules(f: Awaited<ReturnType<typeof fixture>>, enabled = true) {
  return command(`/${f.group.id}/category-rules`, "PUT", {
    rules: enabled ? [{ membershipCategory: f.category, permitsJoin: true, automaticEnrollment: true }] : [],
  });
}
const requests = (type: "group" | "user", id: string) =>
  queryAll(
    env.DB,
    "SELECT id FROM site_publication_requests WHERE resource_type=? AND resource_id=? ORDER BY sequence",
    [type === "group" ? "group_content" : "user_profile", id],
  );
async function projection() {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, members: value.groupMembers, people: value.people };
}
async function state(groupId: string, userId: string) {
  return {
    seats: await queryAll(
      env.DB,
      "SELECT id,group_id,joined_at,left_at FROM group_memberships WHERE user_id=? ORDER BY id",
      [userId],
    ),
    rules: await queryAll(
      env.DB,
      "SELECT membership_category_code,permits_join,automatic_enrollment FROM group_membership_category_rules WHERE group_id=? ORDER BY membership_category_code",
      [groupId],
    ),
    preferences: await queryAll(
      env.DB,
      "SELECT group_id,user_id,opted_out_at FROM group_automatic_enrollment_opt_outs WHERE user_id=? ORDER BY group_id",
      [userId],
    ),
    audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
    requests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence"),
  };
}

beforeEach(async () => {
  await resetDb();
  const userId = await insertUser(env.DB, "enrollment-publication-admin@example.test");
  await grantAdministrator(env.DB, userId);
  token = await createAdminSession(env.DB, userId, "enrollment-publication-admin-token");
});

describe("publication after automatic enrollment", () => {
  it.each([
    { publicRoster: true, changed: true },
    { publicRoster: false, changed: false },
    { publicRoster: false, publicListing: true, changed: false },
    { publicRoster: false, publicListing: true, organization: true, changed: true },
  ])("publishes group-wide rule effects and keeps unchanged refreshes quiet: %j", async ({ changed, ...options }) => {
    const f = await fixture(options);
    const before = await projection();
    const initial = (await requests("group", f.group.id)).length;
    expect((await rules(f)).status).toBe(200);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests("group", f.group.id)).toHaveLength(initial + Number(changed));
    const enrolled = await projection();
    expect((await rules(f)).status).toBe(200);
    expect(await projection()).toEqual(enrolled);
    expect(await requests("group", f.group.id)).toHaveLength(initial + Number(changed));
    expect((await rules(f, false)).status).toBe(200);
    if (changed) expect(await projection()).not.toEqual(enrolled);
    else expect(await projection()).toEqual(enrolled);
    expect(await requests("group", f.group.id)).toHaveLength(initial + 2 * Number(changed));
  });

  it.each([false, true])("publishes user opt-out and reentry only when public: %s", async (publicRoster) => {
    const f = await fixture({ publicRoster });
    expect((await rules(f)).status).toBe(200);
    await reconcileAutomaticGroupEnrollmentForUser(env.DB, f.person.userId);
    let count = (await requests("user", f.person.userId)).length;
    for (const [optedOut, changed] of [
      [true, publicRoster],
      [true, false],
      [false, publicRoster],
      [false, false],
    ] as const) {
      const before = await projection();
      const response = await command(`/${f.group.id}/automatic-enrollment`, "PUT", { optedOut }, f.bearer);
      expect(response.status, await response.clone().text()).toBe(200);
      if (changed) expect(await projection()).not.toEqual(before);
      else expect(await projection()).toEqual(before);
      count += Number(changed);
      expect(await requests("user", f.person.userId)).toHaveLength(count);
    }
  });

  it.each([false, true])(
    "invalidates a stale organization entry after capacity withdrawal (other representative=%s)",
    async (otherRepresentative) => {
      const f = await fixture({ publicRoster: false, publicListing: true, organization: true, anchor: false });
      expect((await rules(f)).status).toBe(200);
      await reconcileAutomaticGroupEnrollmentForUser(env.DB, f.person.userId);
      if (otherRepresentative) {
        const other = await insertUser(env.DB, "unreconciled-enrollment-representative@example.test");
        await addRepresentative(env.DB, f.person.memberId, other);
        await reconcileAutomaticGroupEnrollmentForUser(env.DB, other);
      }
      const before = await projection();
      expect(before.members[f.group.slug]).toHaveLength(1);
      const count = (await requests("user", f.person.userId)).length;
      const at = nowIso();
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET status='inactive',updated_at=? WHERE id=?").bind(at, f.person.memberId),
        ...prepareAutomaticGroupEnrollmentForUserStatements(env.DB, f.person.userId, at),
      ]);
      expect((await projection()).members[f.group.slug]).toEqual([]);
      expect(await projection()).not.toEqual(before);
      expect(await requests("user", f.person.userId)).toHaveLength(count + 1);
    },
  );

  it("captures public descendants closed by group eligibility changes", async () => {
    const f = await fixture({ publicRoster: false, automatic: false });
    expect((await rules(f)).status).toBe(200);
    const add = (group: Group) =>
      command(`/${group.id}/memberships/${f.person.userId}`, "POST", {
        capacitySelection: { mode: "selected", memberIds: [f.person.memberId] },
      });
    expect((await add(f.group)).status).toBe(200);
    const child = await createGroup({
      name: "Public enrollment descendant",
      slug: "public-enrollment-descendant",
      parentGroupId: f.group.id,
      eligibilityMode: "open",
      automaticEnrollmentMode: "none",
      publicRoster: true,
    });
    expect((await add(child)).status).toBe(200);
    const before = await projection();
    const count = (await requests("group", f.group.id)).length;
    expect((await rules(f, false)).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests("group", f.group.id)).toHaveLength(count + 1);
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL", [
        child.id,
        f.person.userId,
      ]),
    ).toEqual([]);
  });

  it.each(
    ["group", "user"].flatMap((scope) =>
      ["add", "end"].flatMap((phase) => ["request", "audit"].map((failure) => ({ scope, phase, failure }))),
    ),
  )("rolls back $scope $phase on $failure failure and retries", async ({ scope, phase, failure }) => {
    const f = await fixture();
    if (scope === "user" || phase === "end") expect((await rules(f)).status).toBe(200);
    if (scope === "user") {
      await reconcileAutomaticGroupEnrollmentForUser(env.DB, f.person.userId);
      if (phase === "add")
        expect((await command(`/${f.group.id}/automatic-enrollment`, "PUT", { optedOut: true }, f.bearer)).status).toBe(
          200,
        );
    }
    const before = await projection();
    const persisted = await state(f.group.id, f.person.userId);
    const mutate = () =>
      scope === "group"
        ? rules(f, phase === "add")
        : command(`/${f.group.id}/automatic-enrollment`, "PUT", { optedOut: phase === "end" }, f.bearer);
    const action = phase === "add" ? "group_automatic_enrollment_added" : "group_automatic_enrollment_ended";
    await env.DB.prepare(`CREATE TRIGGER fail_enrollment_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        ${failure === "audit" ? `WHEN NEW.action='${action}'` : ""}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ENROLLMENT_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await mutate()).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await state(f.group.id, f.person.userId)).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_enrollment_publication").run();
    }
    expect((await mutate()).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect((await state(f.group.id, f.person.userId)).requests).toHaveLength(persisted.requests.length + 1);
  });
});
