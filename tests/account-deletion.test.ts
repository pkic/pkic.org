import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { accountDeletionPreviewResponseSchema } from "../assets/shared/schemas/account-deletion";
import { accountDeletionEmailHash, deleteAccount } from "../functions/_lib/services/account-deletion/delete";
import { readAccountDeletion } from "../functions/_lib/services/account-deletion/preview";
import {
  ACCOUNT_DELETION_BLOCKING_RULES,
  ACCOUNT_DELETION_COVERED_REFERENCES,
  ACCOUNT_DELETION_KEPT_REFERENCES,
  ACCOUNT_DELETION_REMOVED_TABLES,
} from "../functions/_lib/services/account-deletion/registry";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import app from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

interface ForeignKey {
  tbl: string;
  col: string;
  ref: string;
  on_delete: string;
}

async function foreignKeys(): Promise<ForeignKey[]> {
  return queryAll<ForeignKey>(
    env.DB,
    `SELECT m.name AS tbl, p."from" AS col, p."table" AS ref, p.on_delete
       FROM sqlite_master m, pragma_foreign_key_list(m.name) p
      WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'`,
  );
}

/** D1 refuses `pragma_table_info` as a table-valued function, so read each table's columns with its own PRAGMA. */
async function tableColumns(): Promise<{ tbl: string; col: string; keyed: boolean }[]> {
  const tables = await queryAll<{ name: string }>(
    env.DB,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const keys = await foreignKeys();
  const results = await env.DB.batch(tables.map(({ name }) => env.DB.prepare(`PRAGMA table_info("${name}")`)));
  return tables.flatMap(({ name }, index) =>
    (results[index].results as { name: string }[]).map((column) => ({
      tbl: name,
      col: column.name,
      keyed: keys.some((key) => key.tbl === name && key.col === column.name),
    })),
  );
}

const removedIndex = new Map(ACCOUNT_DELETION_REMOVED_TABLES.map((entry, index) => [entry.table, index]));
const removedLinks = ACCOUNT_DELETION_REMOVED_TABLES.flatMap((entry) =>
  entry.links.map((link) => ({ table: entry.table, ...link })),
);

function classified(table: string, column: string, parent: string) {
  const matches = (rule: { table: string; column: string; from?: string }) =>
    rule.table === table && rule.column === column && (rule.from ?? "users") === parent;
  return (
    removedLinks.some(matches) ||
    ACCOUNT_DELETION_BLOCKING_RULES.some(matches) ||
    ACCOUNT_DELETION_COVERED_REFERENCES.some(
      (reference) => reference.table === table && reference.column === column && reference.references === parent,
    )
  );
}

describe("account deletion registry", () => {
  it("classifies every reference to an account and to the records deleted with it", async () => {
    const keys = await foreignKeys();
    const cascades = (into: Set<string>) => {
      let grew = true;
      while (grew) {
        grew = false;
        for (const key of keys)
          if (into.has(key.ref) && key.on_delete === "CASCADE" && !into.has(key.tbl)) {
            into.add(key.tbl);
            grew = true;
          }
      }
      return into;
    };
    const deleted = cascades(new Set(["users", ...removedIndex.keys()]));
    const unclassified = keys
      .filter((key) => deleted.has(key.ref))
      .filter((key) => !classified(key.tbl, key.col, key.ref))
      .map((key) => `${key.tbl}.${key.col} -> ${key.ref}`);
    expect(unclassified).toEqual([]);
  });

  it("names only references that exist", async () => {
    const keys = await foreignKeys();
    const columns = await tableColumns();
    const stale = [...removedLinks, ...ACCOUNT_DELETION_BLOCKING_RULES]
      .filter((rule) =>
        rule.foreignKey === false
          ? !columns.some((column) => column.tbl === rule.table && column.col === rule.column)
          : !keys.some(
              (key) => key.tbl === rule.table && key.col === rule.column && key.ref === (rule.from ?? "users"),
            ),
      )
      .map((rule) => `${rule.table}.${rule.column}`);
    expect(stale).toEqual([]);
  });

  it("classifies account columns that have no foreign key", async () => {
    const unkeyed = (await tableColumns()).filter((column) => !column.keyed && /(user_id|actor_id)$/.test(column.col));
    const known = [
      ...[...removedLinks, ...ACCOUNT_DELETION_BLOCKING_RULES].filter((rule) => rule.foreignKey === false),
      ...ACCOUNT_DELETION_KEPT_REFERENCES,
    ];
    const unclassified = unkeyed
      .filter((column) => !known.some((rule) => rule.table === column.tbl && rule.column === column.col))
      .map((column) => `${column.tbl}.${column.col}`);
    expect(unclassified).toEqual([]);
  });

  it("deletes every child before its parent", async () => {
    const outOfOrder = (await foreignKeys())
      .filter((key) => key.tbl !== key.ref && removedIndex.has(key.tbl) && removedIndex.has(key.ref))
      .filter((key) => key.on_delete !== "CASCADE" && key.on_delete !== "SET NULL")
      .filter((key) => removedIndex.get(key.tbl)! < removedIndex.get(key.ref)!)
      .map((key) => `${key.tbl} before ${key.ref}`);
    expect(outOfOrder).toEqual([]);
  });
});

describe("account deletion", () => {
  let admin: UserBackedAuthAdmin;
  let eventId: string;
  let token: string;

  beforeEach(async () => {
    await resetDb();
    ({ admin, eventId } = await seedEventAndAdmin(env.DB));
    token = await createAdminSession(env.DB, admin.id, "account-deletion-admin");
  });

  function request(path: string, method: string) {
    return app.fetch(
      new Request(`https://app.test${path}`, { method, headers: { authorization: `Bearer ${token}` } }),
      env as never,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    );
  }

  async function preview(userId: string) {
    const response = await request(`/api/v1/users/${userId}/deletion`, "GET");
    expect(response.status).toBe(200);
    return accountDeletionPreviewResponseSchema.parse(await response.json()).deletion;
  }

  async function accountExists(userId: string) {
    return (await queryAll(env.DB, "SELECT 1 FROM users WHERE id = ?", [userId])).length > 0;
  }

  it("deletes an unused account and keeps only a keyed hash of its address", async () => {
    const userId = await insertUser(env.DB, "unused@example.test");
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), userId, "second@example.test", "second@example.test", at),
      env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(`headshots/${userId}/a.png`, userId),
    ]);

    const deletion = await preview(userId);
    expect(deletion.deletable).toBe(true);
    expect(deletion.removes).toContainEqual({ kind: "email_address", count: 1 });

    const response = await request(`/api/v1/users/${userId}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(200);
    expect(await accountExists(userId)).toBe(false);
    expect(await queryAll(env.DB, "SELECT 1 FROM user_emails WHERE user_id = ?", [userId])).toEqual([]);

    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'user_deleted' AND entity_id = ?",
      [userId],
    );
    expect(audit.details_json).not.toMatch(/example\.test/i);
    const emailHashes = (JSON.parse(audit.details_json) as { emailHashes: { to: string[] } }).emailHashes.to;
    expect(emailHashes).toContain(await accountDeletionEmailHash("test-signing-secret", "unused@example.test"));
    expect(emailHashes).toHaveLength(2);
    expect(
      await queryAll(env.DB, "SELECT 1 FROM storage_deletion_outbox WHERE object_key = ?", [
        `headshots/${userId}/a.png`,
      ]),
    ).toHaveLength(1);
  });

  it("deletes a withdrawn proposal, a cancelled registration, and ended group history with the account", async () => {
    const { userId, identityId, memberId } = await insertOrgRepresentative(env.DB, { email: "speaker@example.test" });
    const proposalId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO session_proposals (id, event_id, proposer_user_id, status, proposal_type, title, abstract,
           manage_link_secret, submitted_at, updated_at, withdrawn_at)
         VALUES (?, ?, ?, 'withdrawn', 'talk', 'Withdrawn talk', 'Abstract', ?, ?, ?, ?)`,
      ).bind(proposalId, eventId, userId, crypto.randomUUID(), at, at, at),
      env.DB.prepare(
        `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, manage_link_secret, created_at)
         VALUES (?, ?, ?, 'speaker', 'confirmed', ?, ?)`,
      ).bind(crypto.randomUUID(), proposalId, userId, crypto.randomUUID(), at),
      env.DB.prepare(
        `INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, cancelled_at, created_at, updated_at)
         VALUES (?, ?, ?, 'cancelled', 'test', ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), at, at, at),
    ]);
    await insertGroupSeat("account-deletion", { publicRoster: false }, { userId, memberId, identityId });
    await env.DB.prepare("UPDATE group_memberships SET left_at = ? WHERE user_id = ?")
      .bind(new Date(Date.now() + 1000).toISOString(), userId)
      .run();

    const deletion = await preview(userId);
    expect(deletion.blockers).toEqual([]);
    expect(deletion.removes.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["identity", "registration", "proposal", "group_history"]),
    );
    // The proposal's speaker row is part of the proposal, not a second one.
    expect(deletion.removes).toContainEqual({ kind: "proposal", count: 1 });

    const response = await request(`/api/v1/users/${userId}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(200);
    expect(await accountExists(userId)).toBe(false);
    expect(await queryAll(env.DB, "SELECT 1 FROM session_proposals WHERE id = ?", [proposalId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT 1 FROM group_membership_erasures")).toEqual([]);
  });

  it("keeps an account that other records depend on", async () => {
    const userId = await insertUser(env.DB, "staff@example.test");
    await env.DB.prepare(
      "INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at) VALUES (?, ?, 'users:read', ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, admin.id, nowIso())
      .run();

    const deletion = await preview(userId);
    expect(deletion.deletable).toBe(false);
    expect(deletion.blockers).toEqual([{ kind: "staff_access", count: 1 }]);
    const response = await request(`/api/v1/users/${userId}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(409);
    expect(await accountExists(userId)).toBe(true);
  });

  it("refuses a delete when the account changed after it was reviewed", async () => {
    const userId = await insertUser(env.DB, "changed@example.test");
    const deletion = await preview(userId);
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, "late@example.test", "late@example.test", nowIso())
      .run();

    const response = await request(`/api/v1/users/${userId}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(409);
    expect(await accountExists(userId)).toBe(true);
  });

  it("rolls back when a record that keeps the account appears during the delete", async () => {
    const userId = await insertUser(env.DB, "race@example.test");
    const { preview: reviewed } = await readAccountDeletion(env.DB, userId);
    const gate = gateNextBatch(env.DB, 1);
    const pending = deleteAccount(gate.db, admin, userId, reviewed.revision, "test-signing-secret");
    await gate.reached;
    await env.DB.prepare(
      "INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at) VALUES (?, ?, 'users:read', ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, admin.id, nowIso())
      .run();
    gate.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(await accountExists(userId)).toBe(true);
    expect(await queryAll(env.DB, "SELECT 1 FROM audit_log WHERE action = 'user_deleted'")).toEqual([]);
  });

  it("rolls back when an address is added during the delete", async () => {
    const userId = await insertUser(env.DB, "late-address@example.test");
    const { preview: reviewed } = await readAccountDeletion(env.DB, userId);
    const gate = gateNextBatch(env.DB, 1);
    const pending = deleteAccount(gate.db, admin, userId, reviewed.revision, "test-signing-secret");
    await gate.reached;
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, "unreviewed@example.test", "unreviewed@example.test", nowIso())
      .run();
    gate.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(await accountExists(userId)).toBe(true);
  });

  it("keeps an account while a promotion image for it is being created", async () => {
    const userId = await insertUser(env.DB, "rendering@example.test");
    const at = nowIso();
    await env.DB.prepare(
      `INSERT INTO event_promotion_renders(id,event_id,user_id,revision,format,origin,cache_key,status,next_attempt_at,
         processing_token,lease_expires_at,created_at,updated_at)
       VALUES (?, ?, ?, 1, 'square', 'test', ?, 'rendering', ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        userId,
        crypto.randomUUID(),
        at,
        crypto.randomUUID(),
        new Date(Date.now() + 60_000).toISOString(),
        at,
        at,
      )
      .run();

    const deletion = await preview(userId);
    expect(deletion.blockers).toEqual([{ kind: "promotion_render", count: 1 }]);
  });

  it("removes the account's addresses from earlier audit details", async () => {
    const userId = await insertUser(env.DB, "audited@example.test");
    await env.DB.prepare("UPDATE users SET email = 'Audited@Example.test' WHERE id = ?").bind(userId).run();
    await env.DB.prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'admin', ?, 'user_updated', 'user', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        admin.id,
        userId,
        JSON.stringify({ from: "Audited@Example.test", to: "audited@example.test" }),
        nowIso(),
      )
      .run();

    const deletion = await preview(userId);
    const response = await request(`/api/v1/users/${userId}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(200);
    const [earlier] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'user_updated' AND entity_id = ?",
      [userId],
    );
    expect(JSON.parse(earlier.details_json)).toEqual({ from: "[deleted address]", to: "[deleted address]" });
  });

  it("refuses to delete the signed-in account", async () => {
    const deletion = await preview(admin.id);
    const response = await request(`/api/v1/users/${admin.id}?revision=${deletion.revision}`, "DELETE");
    expect(response.status).toBe(403);
  });
});
