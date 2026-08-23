/**
 * Phase 1 §1.4 required tests, part 3: representative-role grants
 * (role-primary_contact/role-secondary_contact/role-voting_delegate,
 * consolidated migration 0035) — singleton-per-organization uniqueness, that a
 * non-singleton context-scoped role is unaffected by the same index, and
 * the service-layer invariant that replaces the dropped composite FK.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
} from "./helpers/membership";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatements,
  resolveRepresentativeRoleHolder,
  resolveRepresentativeRoleHolders,
} from "../functions/_lib/services/membership/representative-roles";
import { AppError } from "../functions/_lib/errors";

interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
  context_type: string | null;
  context_id: string | null;
  revoked_at: string | null;
}

beforeEach(async () => {
  await resetDb();
});

describe("representative role grants — singleton per organization", () => {
  it("assigning a new primary contact revokes the previous holder atomically, leaving exactly one active grant", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const userA = await insertUser(env.DB);
    const userB = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, userA);
    await addRepresentative(env.DB, memberId, userB);

    await assignRepresentativeRole(env.DB, memberId, userA, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, memberId, userB, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const activeGrants = await queryAll<UserRoleRow>(
      env.DB,
      `SELECT id, user_id, role_id, context_type, context_id, revoked_at FROM user_roles
       WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
      memberId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
    );
    expect(activeGrants).toHaveLength(1);
    expect(activeGrants[0].user_id).toBe(userB);

    const holders = await resolveRepresentativeRoleHolders(env.DB, memberId);
    expect(holders.primaryContactUserId).toBe(userB);
  });

  it("a direct insert without revoking the prior holder is rejected by the DB (uq_user_roles_single_holder_per_context)", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const userA = await insertUser(env.DB);
    const userB = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, userA);
    await addRepresentative(env.DB, memberId, userB);
    await assignRepresentativeRole(env.DB, memberId, userA, REPRESENTATIVE_ROLE_IDS.primaryContact);

    await expect(
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
         VALUES (?, ?, ?, 'organization', ?, 1, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userB, REPRESENTATIVE_ROLE_IDS.primaryContact, memberId)
        .run(),
    ).rejects.toThrow();
  });

  it("enforces singleton independently per role — primary, secondary, and voting delegate can each have their own concurrent active holder", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const primaryUser = await insertUser(env.DB);
    const secondaryUser = await insertUser(env.DB);
    const delegateUser = await insertUser(env.DB);
    for (const userId of [primaryUser, secondaryUser, delegateUser]) {
      await addRepresentative(env.DB, memberId, userId);
    }

    await assignRepresentativeRole(env.DB, memberId, primaryUser, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, memberId, secondaryUser, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    await assignRepresentativeRole(env.DB, memberId, delegateUser, REPRESENTATIVE_ROLE_IDS.votingDelegate);

    const holders = await resolveRepresentativeRoleHolders(env.DB, memberId);
    expect(holders).toEqual({
      primaryContactUserId: primaryUser,
      secondaryContactUserId: secondaryUser,
      votingDelegateUserId: delegateUser,
    });
  });

  it("resolves only active, unexpired representative-role holders", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const primaryUser = await insertUser(env.DB);
    const delegateUser = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, primaryUser);
    await addRepresentative(env.DB, memberId, delegateUser);
    await assignRepresentativeRole(env.DB, memberId, primaryUser, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, memberId, delegateUser, REPRESENTATIVE_ROLE_IDS.votingDelegate);
    await env.DB.prepare(
      `UPDATE user_roles
       SET expires_at = datetime('now', '+1 hour')
       WHERE context_type = 'organization' AND context_id = ? AND role_id = ?`,
    )
      .bind(memberId, REPRESENTATIVE_ROLE_IDS.votingDelegate)
      .run();

    await expect(resolveRepresentativeRoleHolders(env.DB, memberId)).resolves.toMatchObject({
      primaryContactUserId: primaryUser,
      votingDelegateUserId: delegateUser,
    });

    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(delegateUser).run();
    await expect(resolveRepresentativeRoleHolders(env.DB, memberId)).resolves.toMatchObject({
      primaryContactUserId: primaryUser,
      votingDelegateUserId: null,
    });

    await env.DB.prepare("UPDATE users SET active = 1 WHERE id = ?").bind(delegateUser).run();
    await env.DB.prepare(
      `UPDATE user_roles
       SET expires_at = datetime('now', '-1 minute')
       WHERE context_type = 'organization' AND context_id = ? AND role_id = ?`,
    )
      .bind(memberId, REPRESENTATIVE_ROLE_IDS.votingDelegate)
      .run();
    await expect(resolveRepresentativeRoleHolders(env.DB, memberId)).resolves.toMatchObject({
      primaryContactUserId: primaryUser,
      votingDelegateUserId: null,
    });

    await env.DB.prepare(
      "UPDATE user_roles SET expires_at = NULL WHERE context_type = 'organization' AND context_id = ? AND role_id = ?",
    )
      .bind(memberId, REPRESENTATIVE_ROLE_IDS.votingDelegate)
      .run();
    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
    )
      .bind(memberId, delegateUser)
      .run();
    await expect(
      resolveRepresentativeRoleHolder(env.DB, memberId, REPRESENTATIVE_ROLE_IDS.votingDelegate),
    ).resolves.toBe(null);
    await expect(resolveRepresentativeRoleHolders(env.DB, memberId)).resolves.toMatchObject({
      primaryContactUserId: primaryUser,
      votingDelegateUserId: null,
    });
  });

  it("does not constrain a non-singleton context-scoped role (role-event_volunteer) — multiple concurrent active grants allowed", async () => {
    const { eventId: eventContextId } = await seedEventAndAdmin(env.DB);
    const userA = await insertUser(env.DB);
    const userB = await insertUser(env.DB);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
           VALUES (?, ?, 'role-event_volunteer', 'event', ?, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), userA, eventContextId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
           VALUES (?, ?, 'role-event_volunteer', 'event', ?, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), userB, eventContextId),
    ]);

    const activeGrants = await queryAll<UserRoleRow>(
      env.DB,
      `SELECT id, user_id, role_id, context_type, context_id, revoked_at FROM user_roles
       WHERE context_type = 'event' AND context_id = ? AND role_id = 'role-event_volunteer' AND revoked_at IS NULL`,
      eventContextId,
    );
    expect(activeGrants).toHaveLength(2);
  });
});

describe("representative role grants — service-layer invariant (replaces the dropped composite FK)", () => {
  it("rejects granting a representative role to a (user, organization) pair with no active organization_representatives row", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const nonRepresentativeUser = await insertUser(env.DB);

    await expect(
      buildAssignRepresentativeRoleStatements(env.DB, {
        memberId,
        userId: nonRepresentativeUser,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
      }),
    ).rejects.toMatchObject({ status: 422, code: "NOT_ACTIVE_REPRESENTATIVE" });
  });

  it("rejects granting a role to a user whose representative row has since left (left_at set)", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const userId = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, userId);

    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE member_id = ? AND user_id = ?",
    )
      .bind(memberId, userId)
      .run();

    let caught: unknown;
    try {
      await buildAssignRepresentativeRoleStatements(env.DB, {
        memberId,
        userId,
        roleId: REPRESENTATIVE_ROLE_IDS.votingDelegate,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).status).toBe(422);
  });

  it("aborts a stale assignment atomically instead of revoking the current holder", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const currentHolder = await insertUser(env.DB);
    const replacement = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, currentHolder);
    await addRepresentative(env.DB, memberId, replacement);
    await assignRepresentativeRole(env.DB, memberId, currentHolder, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const statements = await buildAssignRepresentativeRoleStatements(env.DB, {
      memberId,
      userId: replacement,
      roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
    });
    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE member_id = ? AND user_id = ?",
    )
      .bind(memberId, replacement)
      .run();

    await expect(env.DB.batch(statements)).rejects.toThrow("representative role requires an active representative");
    expect(
      await queryAll<{ user_id: string }>(
        env.DB,
        `SELECT user_id FROM user_roles
         WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
        memberId,
        REPRESENTATIVE_ROLE_IDS.primaryContact,
      ),
    ).toEqual([{ user_id: currentHolder }]);

    await expect(
      env.DB.prepare("UPDATE user_roles SET user_id = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(replacement, currentHolder)
        .run(),
    ).rejects.toThrow("representative role requires an active representative");
    expect(
      await queryAll<{ user_id: string }>(
        env.DB,
        `SELECT user_id FROM user_roles
         WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
        memberId,
        REPRESENTATIVE_ROLE_IDS.primaryContact,
      ),
    ).toEqual([{ user_id: currentHolder }]);
  });
});
