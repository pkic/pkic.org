import { env } from "cloudflare:workers";
import { createManagedFormPlacement } from "../../functions/_lib/services/forms";
import { createGroup, joinGroup } from "../../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../../functions/_lib/types";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./membership";

export interface ResourceGrantFixture {
  owner: Awaited<ReturnType<typeof createGroup>>;
  grantee: Awaited<ReturnType<typeof createGroup>>;
  outsider: Awaited<ReturnType<typeof createGroup>>;
  formPlacementId: string;
  eventId: string;
  voteId: string;
  mailingListId: string;
}

export async function insertResourceGrantActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

export async function addResourceGrantParticipant(groupId: string, label: string): Promise<UserBackedAuthAdmin> {
  const actor = await insertResourceGrantActor(label);
  const organizationId = await insertOrganization(env.DB, `${label} ${crypto.randomUUID()}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await addRepresentative(env.DB, memberId, actor.id);
  await joinGroup(env.DB, groupId, {
    actorUserId: actor.id,
    targetUserId: actor.id,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  return actor;
}

export async function addResourceGrantGroupLeader(groupId: string, label: string): Promise<UserBackedAuthAdmin> {
  const actor = await insertResourceGrantActor(label);
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), actor.id, groupId)
    .run();
  return actor;
}

/** Creates every FK-backed resource once for cross-resource grant tests. */
export async function createResourceGrantFixture(): Promise<ResourceGrantFixture> {
  const admin = await insertResourceGrantActor("resource-admin", "admin");
  const owner = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Owner ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const grantee = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Grantee ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const outsider = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Outsider ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const formId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO forms
       (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, 'survey', 'active', 'Shared survey', NULL, datetime('now'), datetime('now'))`,
  )
    .bind(formId, `shared-survey-${crypto.randomUUID()}`)
    .run();
  const placement = await createManagedFormPlacement(env.DB, admin.id, formId, {
    ownerGroupId: owner.id,
    contextType: "group",
    contextRef: owner.id,
    audience: "group_member",
    active: true,
  });
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json,
        owner_group_id, profile_key, source_mode, created_at, updated_at)
     VALUES (?, ?, 'Shared event', 'UTC', 'no_registration', 5, '{}', ?, 'meeting', 'portal',
             datetime('now'), datetime('now'))`,
  )
    .bind(eventId, `shared-event-${crypto.randomUUID()}`, owner.id)
    .run();
  const voteId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO votes
       (id, slug, title, vote_type, owner_group_id, electorate_mode, created_by_user_id,
        threshold_type, opens_at, closes_at, created_at, updated_at)
     VALUES (?, ?, 'Shared vote', 'motion', ?, 'per_member', ?, 'simple_majority',
             '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z',
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(voteId, `shared-vote-${crypto.randomUUID()}`, owner.id, admin.id)
    .run();
  const mailingListId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO mailing_lists
       (id, email, label, purpose, group_id, is_primary_discussion, subscription_default,
        posting_policy, moderation_policy, active, created_at, updated_at)
     VALUES (?, ?, 'Shared list', 'group', ?, 0, 'none', 'subscribers', 'moderated', 1,
             datetime('now'), datetime('now'))`,
  )
    .bind(mailingListId, `shared-${crypto.randomUUID()}@lists.example.test`, owner.id)
    .run();
  return { owner, grantee, outsider, formPlacementId: placement.id, eventId, voteId, mailingListId };
}

/** Keeps fixture mailing lists from violating the singleton primary-list seed. */
export async function detachResourceGrantFixtureMailingLists(): Promise<void> {
  await env.DB.prepare(
    `UPDATE mailing_lists
        SET group_id = '20000000-0000-4000-8000-000000000001',
            is_primary_discussion = 0,
            active = 0,
            archived_at = datetime('now')
      WHERE email LIKE 'shared-%@lists.example.test'`,
  ).run();
}
