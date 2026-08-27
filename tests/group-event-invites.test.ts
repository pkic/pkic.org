import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { processOutboxById } from "../functions/_lib/email/outbox";
import { createGroup } from "../functions/_lib/services/groups";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import { buildEventInvitesPageQuery } from "../functions/_lib/services/events/event-invite-list";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import {
  resendGroupEventAttendeeInvite,
  revokeGroupEventAttendeeInvite,
} from "../functions/_lib/services/events/group-invite-management";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";

async function actor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function insertInvite(eventId: string, inviteType: "attendee" | "speaker"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invites
       (id, event_id, invitee_email, invitee_first_name, invitee_last_name, invite_type, link_secret, status, source_type, created_at)
     VALUES (?, ?, ?, 'Invited', 'Person', ?, ?, 'sent', 'direct', datetime('now'))`,
  )
    .bind(id, eventId, `${inviteType}-${id}@example.test`, inviteType, crypto.randomUUID())
    .run();
  return id;
}

function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return callApi(env, path, { ...init, headers });
}

function inviteMutationSnapshot(inviteId: string) {
  return Promise.all([
    env.DB.prepare("SELECT status FROM invites WHERE id = ?").bind(inviteId).first<{ status: string }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first<{ count: number }>(),
  ]);
}

function createInviteEvent(actor: UserBackedAuthAdmin, groupId: string, label: string) {
  return createGroupManagedEvent(env.DB, actor, groupId, {
    name: label,
    slug: `invite-event-${crypto.randomUUID()}`,
    timezone: "UTC",
    startsAt: "2027-01-10T10:00:00.000Z",
    endsAt: "2027-01-10T18:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 5,
    location: "Online",
    links: [],
  });
}

describe("selected-group attendee invitation lifecycle", () => {
  beforeEach(resetDb);

  it("lists only attendees, keeps the projection narrow, and rejects speaker IDs", async () => {
    const administrator = await actor("invite-owner", "admin");
    const owner = await createGroup(env.DB, administrator, {
      typeKey: "working_group",
      name: `Invite owner ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const series = await createInviteEvent(administrator, owner.id, "Invite test");
    const attendeeId = await insertInvite(series.eventId, "attendee");
    const speakerId = await insertInvite(series.eventId, "speaker");
    const token = await createAdminSession(env.DB, administrator.id, `invite-owner-${crypto.randomUUID()}`);

    const productionQuery = buildEventInvitesPageQuery(series.eventId, {
      type: "attendee",
      status: "sent",
      limit: 20,
      offset: 0,
    });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(productionQuery);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, productionQuery.limit, productionQuery.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);
    expect(pageSql).toContain("CASE");
    expect(countSql).toContain("CASE");
    expect(pagePlan.results.map((row) => row.detail).join("\n")).toContain("idx_invites_event_type_created");
    expect(countPlan.results.map((row) => row.detail).join("\n")).toContain("idx_invites_event_type_created");

    const list = await request(token, `/api/v1/groups/${owner.id}/events/${series.eventId}/invites`);
    expect(list.status, await list.clone().text()).toBe(200);
    const body = (await list.json()) as { invites: Array<Record<string, unknown>>; page: { total: number } };
    expect(body.page.total).toBe(1);
    expect(body.invites[0]).toMatchObject({ id: attendeeId, inviteType: "attendee" });
    expect(body.invites[0]).not.toHaveProperty("inviterUserId");
    expect(body.invites[0]).not.toHaveProperty("declineReasonNote");
    expect(body.invites[0]).not.toHaveProperty("unsubscribeFuture");

    const beforeSpeakerAttempt = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first<{ count: number }>(),
    ]);

    const speakerResend = await request(
      token,
      `/api/v1/groups/${owner.id}/events/${series.eventId}/invites/${speakerId}/resend`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    );
    expect(speakerResend.status).toBe(404);
    const afterSpeakerAttempt = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first<{ count: number }>(),
    ]);
    expect(afterSpeakerAttempt).toEqual(beforeSpeakerAttempt);
    const attendeeRevoke = await request(
      token,
      `/api/v1/groups/${owner.id}/events/${series.eventId}/invites/${attendeeId}/revoke`,
      { method: "POST" },
    );
    expect(attendeeRevoke.status, await attendeeRevoke.clone().text()).toBe(200);
    await expect(
      env.DB.prepare("SELECT status FROM invites WHERE id = ?").bind(attendeeId).first<{ status: string }>(),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(
      env.DB.prepare(
        `SELECT actor_id, scope_type, scope_id
             FROM audit_log
            WHERE action = 'invite_revoked' AND entity_type = 'invite' AND entity_id = ?`,
      )
        .bind(attendeeId)
        .first<{ actor_id: string; scope_type: string; scope_id: string }>(),
    ).resolves.toEqual({ actor_id: administrator.id, scope_type: "group", scope_id: owner.id });
  });

  it("allows a delegated selected-group manager without widening event ownership", async () => {
    const administrator = await actor("invite-delegator", "admin");
    const owner = await createGroup(env.DB, administrator, {
      typeKey: "working_group",
      name: `Invite source ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const grantee = await createGroup(env.DB, administrator, {
      typeKey: "working_group",
      name: `Invite grantee ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const leader = await actor("invite-grantee");
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), leader.id, grantee.id)
      .run();
    const series = await createInviteEvent(administrator, owner.id, "Delegated invite test");
    await grantResourceToGroup(env.DB, administrator, owner.id, "event", series.eventId, {
      granteeGroupId: grantee.id,
      capability: "manage",
    });
    const attendeeId = await insertInvite(series.eventId, "attendee");
    const token = await createAdminSession(env.DB, leader.id, `invite-grantee-${crypto.randomUUID()}`);
    const response = await request(token, `/api/v1/groups/${grantee.id}/events/${series.eventId}/invites?q=attendee`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as { page: { total: number } }).page.total).toBe(1);

    await env.DB.prepare("DELETE FROM event_group_grants WHERE event_id = ? AND group_id = ? AND capability = 'manage'")
      .bind(series.eventId, grantee.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO event_group_grants
         (event_id, group_id, capability, created_by_user_id, created_at)
       VALUES (?, ?, 'manage_attendance', ?, datetime('now'))`,
    )
      .bind(series.eventId, grantee.id, administrator.id)
      .run();
    const beforeAttendanceOnly = await inviteMutationSnapshot(attendeeId);
    const attendanceOnlyList = await request(token, `/api/v1/groups/${grantee.id}/events/${series.eventId}/invites`);
    expect(attendanceOnlyList.status).toBe(403);
    const attendanceOnlyRevoke = await request(
      token,
      `/api/v1/groups/${grantee.id}/events/${series.eventId}/invites/${attendeeId}/revoke`,
      { method: "POST" },
    );
    expect(attendanceOnlyRevoke.status).toBe(403);
    await expect(inviteMutationSnapshot(attendeeId)).resolves.toEqual(beforeAttendanceOnly);

    await env.DB.prepare(
      "DELETE FROM event_group_grants WHERE event_id = ? AND group_id = ? AND capability = 'manage_attendance'",
    )
      .bind(series.eventId, grantee.id)
      .run();
    const beforeUngrant = await inviteMutationSnapshot(attendeeId);
    const ungrantedList = await request(token, `/api/v1/groups/${grantee.id}/events/${series.eventId}/invites`);
    expect(ungrantedList.status).toBe(403);
    const ungrantedRevoke = await request(
      token,
      `/api/v1/groups/${grantee.id}/events/${series.eventId}/invites/${attendeeId}/revoke`,
      { method: "POST" },
    );
    expect(ungrantedRevoke.status).toBe(403);
    await expect(inviteMutationSnapshot(attendeeId)).resolves.toEqual(beforeUngrant);

    await env.DB.prepare(
      `INSERT INTO event_group_grants
         (event_id, group_id, capability, created_by_user_id, created_at)
       VALUES (?, ?, 'manage', ?, datetime('now'))`,
    )
      .bind(series.eventId, grantee.id, administrator.id)
      .run();
    const beforeManagementRace = await inviteMutationSnapshot(attendeeId);
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare(
        "DELETE FROM event_group_grants WHERE event_id = ? AND group_id = ? AND capability = 'manage'",
      )
        .bind(series.eventId, grantee.id)
        .run();
    });
    await expect(
      revokeGroupEventAttendeeInvite(racingDb, leader, grantee.id, series.eventId, attendeeId),
    ).rejects.toMatchObject({ status: 409, code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    await expect(inviteMutationSnapshot(attendeeId)).resolves.toEqual(beforeManagementRace);
  });

  it("cancels a resend queued before revoke without calling the provider", async () => {
    const administrator = await actor("invite-revoke-race", "admin");
    const owner = await createGroup(env.DB, administrator, {
      typeKey: "working_group",
      name: `Invite race ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const series = await createInviteEvent(administrator, owner.id, "Invite race test");
    await seedWorkflowEmailTemplates(env.DB, administrator.id);
    const inviteId = await insertInvite(series.eventId, "attendee");
    const result = await resendGroupEventAttendeeInvite(
      env.DB,
      administrator,
      owner.id,
      series.eventId,
      inviteId,
      "https://app.test",
    );
    const outboxId = result.outboxId;
    await revokeGroupEventAttendeeInvite(env.DB, administrator, owner.id, series.eventId, inviteId);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(processOutboxById(env.DB, env as any, outboxId!)).rejects.toMatchObject({
      code: "CAPABILITY_RESOURCE_STALE",
    });
    expect(provider).not.toHaveBeenCalled();
    await expect(
      env.DB.prepare("SELECT status FROM email_outbox WHERE id = ?").bind(outboxId).first<{ status: string }>(),
    ).resolves.toMatchObject({ status: "cancelled" });
    vi.unstubAllGlobals();
  });
});
