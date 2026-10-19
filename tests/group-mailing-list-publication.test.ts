import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema } from "../assets/shared/schemas/groups";
import { mailingListResponseSchema } from "../assets/shared/schemas/mailing-lists";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { updateMailingList, updateGroupMailingList } from "../functions/_lib/services/mailing-list-management/commands";
import { prepareGroupManagementAuthorizationGuard } from "../functions/_lib/services/groups/governance";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

let token: string;
let admin: UserBackedAuthAdmin;
const initialEmail = "discussion@lists.example.test";
async function command(path: string, method: string, body?: unknown) {
  return callApi(env, `/api/v1/groups${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function fixture(options: { privateGroup?: boolean; inactiveGroup?: boolean } = {}) {
  const response = await command("", "POST", {
    typeKey: "working_group",
    name: "Discussion publication",
    slug: "discussion-publication",
    visibility: options.privateGroup ? "authenticated" : "public",
    publicRoster: true,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const group = groupSchema.parse(((await response.json()) as { group: unknown }).group);
  if (options.inactiveGroup) expect((await command(`/${group.id}`, "PATCH", { active: false })).status).toBe(200);
  return { group, path: `/${group.id}/mailing-lists` };
}
const listBody = (extra: Record<string, unknown> = {}) => ({
  email: initialEmail,
  label: "Group discussion",
  purpose: "group",
  primaryDiscussion: true,
  subscriptionDefault: "none",
  ...extra,
});
async function create(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  const response = await command(f.path, "POST", listBody(extra));
  expect(response.status, await response.clone().text()).toBe(201);
  return mailingListResponseSchema.parse(await response.json()).mailingList;
}
async function projection() {
  return (await readSitePublicationSnapshot(env.DB, [])).groups;
}
const requests = (groupId: string) =>
  queryAll(
    env.DB,
    "SELECT id FROM site_publication_requests WHERE resource_type='group_content' AND resource_id=? ORDER BY sequence",
    [groupId],
  );
async function state() {
  return {
    lists: await queryAll(
      env.DB,
      "SELECT id,email,active,archived_at,is_primary_discussion FROM mailing_lists ORDER BY id",
    ),
    audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
    requests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence"),
  };
}

beforeEach(async () => {
  await resetDb();
  const id = await insertUser(env.DB, "discussion-publication-admin@example.test");
  const grants = await grantAdministrator(env.DB, id);
  admin = { identityType: "user", id, email: "discussion-publication-admin@example.test", grants };
  token = await createAdminSession(env.DB, id, "discussion-publication-admin-token");
});

describe("publication of public group discussion addresses", () => {
  it.each([
    { changed: true },
    { secondary: true, changed: false },
    { inactive: true, changed: false },
    { privateGroup: true, changed: false },
    { inactiveGroup: true, changed: false },
  ])(
    "publishes only a displayed address on creation and edit: %j",
    async ({ changed, secondary, inactive, ...options }) => {
      const f = await fixture(options);
      const before = await projection();
      const count = (await requests(f.group.id)).length;
      const list = await create(f, { primaryDiscussion: !secondary, active: !inactive });
      if (changed) expect(await projection()).not.toEqual(before);
      else expect(await projection()).toEqual(before);
      expect(await requests(f.group.id)).toHaveLength(count + Number(changed));
      const created = await projection();
      const edited = await command(`${f.path}/${list.id}`, "PATCH", { email: "renamed-discussion@lists.example.test" });
      expect(edited.status, await edited.clone().text()).toBe(options.inactiveGroup ? 409 : 200);
      if (options.inactiveGroup) {
        await expect(edited.json()).resolves.toMatchObject({ error: { code: "MAILING_LIST_AUTHORIZATION_CHANGED" } });
        expect(await env.DB.prepare("SELECT email FROM mailing_lists WHERE id=?").bind(list.id).first("email")).toBe(
          initialEmail,
        );
      }
      if (changed) expect(await projection()).not.toEqual(created);
      else expect(await projection()).toEqual(created);
      expect(await requests(f.group.id)).toHaveLength(count + 2 * Number(changed));
    },
  );

  it("keeps repeated address values and internal configuration edits quiet", async () => {
    const f = await fixture();
    const list = await create(f);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    for (const patch of [
      { email: initialEmail },
      { active: true, primaryDiscussion: true },
      { label: "Internal label" },
      { moderationPolicy: "unmoderated" },
    ]) {
      const response = await command(`${f.path}/${list.id}`, "PATCH", patch);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await projection()).toEqual(before);
      expect(await requests(f.group.id)).toEqual(beforeRequests);
    }
  });

  it("publishes primary and active toggles, lifecycle transitions and deletion", async () => {
    const f = await fixture();
    const list = await create(f);
    let count = (await requests(f.group.id)).length;
    for (const [patch, email] of [
      [{ primaryDiscussion: false }, null],
      [{ primaryDiscussion: true }, initialEmail],
      [{ active: false }, null],
      [{ active: true }, initialEmail],
    ] as const) {
      expect((await command(`${f.path}/${list.id}`, "PATCH", patch)).status).toBe(200);
      expect((await projection())[f.group.slug].mailingListEmail).toBe(email);
      expect(await requests(f.group.id)).toHaveLength(++count);
    }
    for (const [transition, changed, email] of [
      ["archive", true, null],
      ["archive", false, null],
      ["restore", true, initialEmail],
      ["restore", false, initialEmail],
    ] as const) {
      expect((await command(`${f.path}/${list.id}/transitions`, "POST", { transition })).status).toBe(200);
      expect((await projection())[f.group.slug].mailingListEmail).toBe(email);
      count += Number(changed);
      expect(await requests(f.group.id)).toHaveLength(count);
    }
    expect((await command(`${f.path}/${list.id}`, "DELETE")).status).toBe(200);
    expect((await projection())[f.group.slug].mailingListEmail).toBeNull();
    expect(await requests(f.group.id)).toHaveLength(count + 1);
  });

  it("preserves the replacement primary address when restoration conflicts", async () => {
    const f = await fixture();
    const list = await create(f);
    expect((await command(`${f.path}/${list.id}/transitions`, "POST", { transition: "archive" })).status).toBe(200);
    await create(f, { email: "replacement-discussion@lists.example.test" });
    const before = await projection();
    const persisted = await state();
    expect((await command(`${f.path}/${list.id}/transitions`, "POST", { transition: "restore" })).status).toBe(409);
    expect(await projection()).toEqual(before);
    expect(await state()).toEqual(persisted);
  });

  it("reads the committing address after a concurrent edit wins", async () => {
    const f = await fixture();
    const list = await create(f);
    const patch = { email: "winning-discussion@lists.example.test" };
    let winner: Awaited<ReturnType<typeof projection>> | undefined;
    let winningRequests: Awaited<ReturnType<typeof requests>> = [];
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await updateGroupMailingList(env.DB, admin, f.group.id, list.id, patch);
      winner = await projection();
      winningRequests = await requests(f.group.id);
    });
    await updateMailingList(db, list.id, patch, admin.id, {
      authorizationGuards: [prepareGroupManagementAuthorizationGuard(db, admin, [f.group.id])],
      auditScope: { type: "group", id: f.group.id },
    });
    expect(winner).toBeDefined();
    expect(await projection()).toEqual(winner);
    expect(await requests(f.group.id)).toEqual(winningRequests);
  });

  it.each(
    ["create", "edit", "archive", "restore", "delete"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back public $operation on $failure failure and retries", async ({ operation, failure }) => {
    const f = await fixture();
    const list = operation === "create" ? null : await create(f);
    if (operation === "restore")
      expect((await command(`${f.path}/${list!.id}/transitions`, "POST", { transition: "archive" })).status).toBe(200);
    const path =
      operation === "create"
        ? f.path
        : `${f.path}/${list!.id}${["archive", "restore"].includes(operation) ? "/transitions" : ""}`;
    const method = operation === "edit" ? "PATCH" : operation === "delete" ? "DELETE" : "POST";
    const body =
      operation === "create"
        ? listBody()
        : operation === "edit"
          ? { email: "retried-discussion@lists.example.test" }
          : operation === "delete"
            ? undefined
            : { transition: operation };
    const action =
      operation === "create"
        ? "created"
        : operation === "edit"
          ? "updated"
          : operation === "delete"
            ? "deleted"
            : operation === "archive"
              ? "archived"
              : "restored";
    const before = await projection();
    const persisted = await state();
    await env.DB.prepare(`CREATE TRIGGER fail_discussion_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        ${failure === "audit" ? `WHEN NEW.action='mailing_list_${action}'` : ""}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DISCUSSION_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await command(path, method, body)).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await state()).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_discussion_publication").run();
    }
    expect((await command(path, method, body)).status).toBe(operation === "create" ? 201 : 200);
    expect(await projection()).not.toEqual(before);
    expect((await state()).requests).toHaveLength(persisted.requests.length + 1);
  });
});
