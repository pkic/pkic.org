import { processOutboxById } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { IDENTITY_NOTIFICATION_EMAIL_TEMPLATE } from "../assets/shared/email-template-actions";
import { nowIso } from "../functions/_lib/utils/time";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptPendingIdentity } from "../functions/_lib/services/identities";
import { deliveredEmailPayload, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { createMemberSession, createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function publicationCount(identityId: string) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS count FROM site_publication_requests WHERE resource_type='identity_profile' AND resource_id=?",
  )
    .bind(identityId)
    .first<number>("count");
}

async function asUser(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function inviteIdentity(): Promise<{
  organizationId: string;
  contactToken: string;
  identityId: string;
  invitedUserId: string;
  invitedToken: string;
}> {
  const organizationId = await insertOrganization(env.DB, "Invitation Lifecycle Organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const contactUserId = await insertUser(env.DB, "contact@invitation-lifecycle.example");
  const contactIdentityId = await addRepresentative(env.DB, memberId, contactUserId);
  await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  const contactToken = await createMemberSession(
    env.DB,
    contactUserId,
    "identity-invitation-contact-token",
    undefined,
    contactIdentityId,
  );
  const invitedUserId = await insertUser(env.DB, "invited@invitation-lifecycle.example");
  const response = await asUser(contactToken, `/api/v1/organizations/${organizationId}/identities`, {
    method: "POST",
    body: JSON.stringify({
      userReference: "existing_user",
      jobTitle: "Representative",
      userId: invitedUserId,
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const receipt = (await response.json()) as { identityId: string; state: string };
  expect(receipt.state).toBe("pending");
  return {
    organizationId,
    contactToken,
    identityId: receipt.identityId,
    invitedUserId,
    invitedToken: await createMemberSession(env.DB, invitedUserId, "pending-identity-session-token"),
  };
}

async function deliveredInvitationToken(identityId: string): Promise<string> {
  const queued = await env.DB.prepare(
    "SELECT payload_json FROM email_outbox WHERE substr(idempotency_key, 1, length(?)) = ? AND template_key = 'organization-identity-changed' LIMIT 1",
  )
    .bind(`organization-identity:${identityId}:invited:`, `organization-identity:${identityId}:invited:`)
    .first<{ payload_json: string }>();
  expect(queued).toBeTruthy();
  const delivered = await deliveredEmailPayload<{ invitationToken: string }>(env.DB, env, queued!.payload_json);
  return delivered.invitationToken;
}

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());

describe("identity invitation acceptance", () => {
  it("refuses to send an invitation using an old linkless template, then delivers a usable link after the template is repaired", async () => {
    const provider = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 202, headers: { "x-message-id": "synthetic-invitation" } }),
    );
    vi.stubGlobal("fetch", provider);
    const f = await inviteIdentity();
    await seedWorkflowEmailTemplates(env.DB, f.invitedUserId);
    const key = "organization-identity-changed";
    const legacy = await createTemplateVersion(env.DB, {
      templateKey: key,
      subjectTemplate: "Invitation",
      content:
        "Hi {{recipientName}},\n\n{{changeMessage}}\n\nInvitations require the recipient to sign in and accept them.",
      contentType: "markdown",
      createdByUserId: f.invitedUserId,
    });
    await activateTemplateVersion(env.DB, { templateKey: key, version: legacy.version });
    const row = await env.DB.prepare(
      "SELECT id FROM email_outbox WHERE template_key=? AND substr(idempotency_key,1,length(?))=? LIMIT 1",
    )
      .bind(key, `organization-identity:${f.identityId}:invited:`, `organization-identity:${f.identityId}:invited:`)
      .first<{ id: string }>();
    const retry = () =>
      env.DB.prepare("UPDATE email_outbox SET status='queued',send_after=? WHERE id=?").bind(nowIso(), row!.id).run();
    await retry();
    provider.mockClear();
    await expect(processOutboxById(env.DB, env, row!.id)).rejects.toThrow("required action link");
    expect(provider).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT status FROM email_outbox WHERE id=?").bind(row!.id).first("status")).toBe(
      "retrying",
    );
    const correct = IDENTITY_NOTIFICATION_EMAIL_TEMPLATE;
    const version = await createTemplateVersion(env.DB, {
      templateKey: key,
      subjectTemplate: correct.subjectTemplate,
      content: correct.content,
      contentType: "markdown",
      createdByUserId: f.invitedUserId,
    });
    await activateTemplateVersion(env.DB, { templateKey: key, version: version.version });
    await retry();
    await processOutboxById(env.DB, env, row!.id);
    expect(provider).toHaveBeenCalledTimes(1);
    const delivery = JSON.parse(String(provider.mock.calls[0]![1]?.body)) as {
      personalizations: Array<{ to: Array<{ email: string }> }>;
      content: Array<{ type: string; value: string }>;
    };
    expect(delivery.personalizations[0]!.to[0]!.email).toBe("invited@invitation-lifecycle.example");
    const html = delivery.content.find((part) => part.type === "text/html")!.value;
    const text = delivery.content.find((part) => part.type === "text/plain")!.value;
    const url = html.match(/href="([^"]*\/portal\/#\/identity-invitations\?token=[^"]+)"/)?.[1];
    expect(url).toBeTruthy();
    expect(text).toContain(url!);
    const token = new URL(url!).hash.split("token=")[1]!;
    const preview = await callApi(env, "/api/v1/identities/invitations/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: decodeURIComponent(token) }),
    });
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(
      await env.DB.prepare("SELECT started_at FROM identities WHERE id=?").bind(f.identityId).first("started_at"),
    ).toBeNull();
  });

  it("lists pending invitations directly in one complete request", async () => {
    const f = await inviteIdentity();
    const response = await callApi(
      env,
      "/api/v1/users/current/identities?state=pending",
      { headers: { authorization: `Bearer ${f.invitedToken}` } },
      { maxRoundTrips: 1 },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      identities: Array<{ id: string; state: string }>;
      page: { total: number };
    };
    expect(body.identities).toMatchObject([{ id: f.identityId, state: "pending" }]);
    expect(body.page.total).toBe(1);
  });

  it("reviews and accepts an emailed invitation without signing in, only after an explicit POST", async () => {
    const { identityId, invitedUserId } = await inviteIdentity();
    const token = await deliveredInvitationToken(identityId);
    const body = JSON.stringify({ token });
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };

    expect(await publicationCount(identityId)).toBe(0);
    const reviewed = await callApi(env, "/api/v1/identities/invitations/preview", init);
    expect(reviewed.status, await reviewed.clone().text()).toBe(200);
    expect(await reviewed.json()).toMatchObject({
      success: true,
      organizationName: "Invitation Lifecycle Organization",
      recipientEmail: "invited@invitation-lifecycle.example",
    });
    expect(await env.DB.prepare("SELECT started_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
      started_at: null,
    });

    const accepted = await callApi(env, "/api/v1/identities/invitations/accept", init);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await accepted.json()).toMatchObject({ success: true, identityId, state: "active" });
    expect(await publicationCount(identityId)).toBe(1);
    expect(
      await env.DB.prepare("SELECT started_at FROM identities WHERE id = ?").bind(identityId).first(),
    ).toMatchObject({
      started_at: expect.any(String),
    });
    expect(
      Number(
        (
          await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
            .bind(invitedUserId)
            .first<{ total: number }>()
        )?.total ?? 0,
      ),
    ).toBeGreaterThan(0);
    expect((await callApi(env, "/api/v1/identities/invitations/accept", init)).status).toBe(404);
    expect((await callApi(env, "/api/v1/identities/invitations/preview", init)).status).toBe(404);
    expect(await publicationCount(identityId)).toBe(1);
  });

  it.each(["session", "link"])("rolls back %s acceptance and preserves retry when publication fails", async (mode) => {
    const { identityId, invitedUserId, invitedToken } = await inviteIdentity();
    const token = mode === "link" ? await deliveredInvitationToken(identityId) : null;
    const accept = () =>
      mode === "link"
        ? callApi(env, "/api/v1/identities/invitations/accept", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          })
        : asUser(invitedToken, `/api/v1/users/current/identities/${identityId}`, {
            method: "PATCH",
            body: JSON.stringify({ transition: { state: "active" } }),
          });
    await env.DB.prepare(`CREATE TRIGGER fail_invitation_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_INVITATION_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await accept()).status).toBe(500);
      expect(
        await env.DB.prepare("SELECT started_at FROM identities WHERE id=?").bind(identityId).first("started_at"),
      ).toBeNull();
      expect(await publicationCount(identityId)).toBe(0);
      expect(
        (
          await env.DB.prepare("SELECT id FROM group_memberships WHERE user_id=? AND left_at IS NULL")
            .bind(invitedUserId)
            .all()
        ).results,
      ).toHaveLength(0);
      expect(
        (
          await env.DB.prepare(
            "SELECT id FROM audit_log WHERE action='organization_identity_invitation_accepted' AND entity_id=?",
          )
            .bind(identityId)
            .all()
        ).results,
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_invitation_publication").run();
    }
    const retried = await accept();
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(await publicationCount(identityId)).toBe(1);
  });

  it("rejects an invitation link after the recipient account email changes", async () => {
    const { identityId, invitedUserId } = await inviteIdentity();
    const token = await deliveredInvitationToken(identityId);
    await env.DB.prepare("UPDATE users SET email = ?, normalized_email = ? WHERE id = ?")
      .bind("changed@invitation-lifecycle.example", "changed@invitation-lifecycle.example", invitedUserId)
      .run();
    const response = await callApi(env, "/api/v1/identities/invitations/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(response.status).toBe(404);
  });

  it("keeps a sign-in invitation capacity-only until the exact user accepts, then enrolls atomically", async () => {
    const { identityId, invitedUserId, invitedToken } = await inviteIdentity();

    const sessionBefore = await asUser(invitedToken, "/api/v1/auth/session");
    expect(sessionBefore.status).toBe(200);
    expect(await sessionBefore.json()).toMatchObject({
      success: true,
      identity: { id: invitedUserId },
      pendingIdentityCount: 1,
    });
    expect((await asUser(invitedToken, "/api/v1/users/current/groups")).status).toBe(403);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
        .bind(invitedUserId)
        .first(),
    ).toEqual({ total: 0 });

    const accepted = await asUser(invitedToken, `/api/v1/users/current/identities/${identityId}`, {
      method: "PATCH",
      body: JSON.stringify({ transition: { state: "active" } }),
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await accepted.json()).toMatchObject({ success: true, identityId, state: "active" });
    expect(await publicationCount(identityId)).toBe(1);
    expect(
      await env.DB.prepare("SELECT started_at, ended_at FROM identities WHERE id = ?").bind(identityId).first(),
    ).toMatchObject({ started_at: expect.any(String), ended_at: null });
    expect(
      Number(
        (
          await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
            .bind(invitedUserId)
            .first<{ total: number }>()
        )?.total ?? 0,
      ),
    ).toBeGreaterThan(0);
  });

  it("does not reveal or accept another user's pending identity", async () => {
    const { identityId } = await inviteIdentity();
    const other = await insertIndividualMember(env.DB, "H6", "other@invitation-lifecycle.example");
    const otherToken = await createMemberSession(
      env.DB,
      other.userId,
      "other-identity-session-token",
      undefined,
      other.identityId,
    );

    const response = await asUser(otherToken, `/api/v1/users/current/identities/${identityId}`, {
      method: "PATCH",
      body: JSON.stringify({ transition: { state: "active" } }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_INVITATION_NOT_FOUND" } });
  });

  it("rolls back acceptance and enrollment if the session or invitation changes before commit", async () => {
    const { identityId, invitedUserId } = await inviteIdentity();
    const session = await env.DB.prepare(
      "SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
      .bind(invitedUserId)
      .first<{ id: string }>();
    expect(session).toBeTruthy();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").bind(session!.id).run(),
    );

    await expect(
      acceptPendingIdentity(racingDb, { identityId, userId: invitedUserId, sessionId: session!.id }),
    ).rejects.toMatchObject({ status: 409, code: "IDENTITY_AUTHORIZATION_CHANGED" });
    expect(await publicationCount(identityId)).toBe(0);
    expect(await env.DB.prepare("SELECT started_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
      started_at: null,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
        .bind(invitedUserId)
        .first(),
    ).toEqual({ total: 0 });
  });
  describe("ending an identity", () => {
    async function acceptedIdentity() {
      const invited = await inviteIdentity();
      const accepted = await asUser(invited.invitedToken, `/api/v1/users/current/identities/${invited.identityId}`, {
        method: "PATCH",
        body: JSON.stringify({ transition: { state: "active" } }),
      });
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      await env.DB.prepare("UPDATE identities SET invited_at = ?, started_at = ? WHERE id = ?")
        .bind("2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", invited.identityId)
        .run();
      return invited;
    }

    const endOwn = (token: string, identityId: string, endedAt?: string) =>
      asUser(token, `/api/v1/users/current/identities/${identityId}`, {
        method: "PATCH",
        body: JSON.stringify({ transition: { state: "ended", ...(endedAt ? { endedAt } : {}) } }),
      });

    it("rolls back an owner's end and its closed seats when publication fails", async () => {
      const { identityId, invitedUserId, invitedToken } = await acceptedIdentity();
      const seatsBefore = (
        await env.DB.prepare("SELECT id FROM group_memberships WHERE user_id=? AND left_at IS NULL ORDER BY id")
          .bind(invitedUserId)
          .all()
      ).results;
      await env.DB.prepare(`CREATE TRIGGER fail_owner_end_publication BEFORE INSERT ON site_publication_requests
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_OWNER_END_PUBLICATION_FAILURE'); END`).run();
      try {
        expect((await endOwn(invitedToken, identityId)).status).toBe(500);
        expect(
          await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(identityId).first("ended_at"),
        ).toBeNull();
        expect(
          (
            await env.DB.prepare("SELECT id FROM group_memberships WHERE user_id=? AND left_at IS NULL ORDER BY id")
              .bind(invitedUserId)
              .all()
          ).results,
        ).toEqual(seatsBefore);
        expect(await publicationCount(identityId)).toBe(1);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_owner_end_publication").run();
      }
      const retried = await endOwn(invitedToken, identityId);
      expect(retried.status, await retried.clone().text()).toBe(200);
      expect(await publicationCount(identityId)).toBe(2);
    });

    it("lets the owner end an active identity at a past instant and ends its seats at the later of join and end", async () => {
      const { identityId, invitedUserId, invitedToken } = await acceptedIdentity();
      const seats = await env.DB.prepare("SELECT id FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
        .bind(invitedUserId)
        .all<{ id: string }>();
      expect(seats.results.length).toBeGreaterThan(0);
      const [early, ...late] = seats.results;
      await env.DB.prepare("UPDATE group_memberships SET joined_at = ? WHERE id = ?")
        .bind("2026-02-01T00:00:00.000Z", early!.id)
        .run();

      const endedAt = "2026-03-01T00:00:00.000Z";
      const response = await endOwn(invitedToken, identityId, endedAt);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, identityId, state: "ended" });
      expect(await env.DB.prepare("SELECT ended_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
        ended_at: endedAt,
      });
      expect(
        await env.DB.prepare("SELECT left_at FROM group_memberships WHERE id = ?").bind(early!.id).first(),
      ).toEqual({ left_at: endedAt });
      for (const seat of late) {
        const row = await env.DB.prepare("SELECT joined_at, left_at FROM group_memberships WHERE id = ?")
          .bind(seat.id)
          .first<{ joined_at: string; left_at: string }>();
        expect(row!.left_at).toBe(row!.joined_at > endedAt ? row!.joined_at : endedAt);
      }
      expect(
        await env.DB.prepare(
          "SELECT details_json FROM audit_log WHERE action = 'organization_identity_ended' AND entity_id = ?",
        )
          .bind(identityId)
          .first<{ details_json: string }>(),
      ).toMatchObject({ details_json: expect.stringContaining('"ended_by":{"from":null,"to":"owner"}') });
    });

    it("defaults the owner's end date to now", async () => {
      const { identityId, invitedToken } = await acceptedIdentity();
      const response = await endOwn(invitedToken, identityId);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        await env.DB.prepare("SELECT ended_at FROM identities WHERE id = ?").bind(identityId).first(),
      ).toMatchObject({ ended_at: expect.any(String) });
    });

    it("refuses an end date in the future or before the identity started", async () => {
      const { identityId, invitedToken } = await acceptedIdentity();
      const future = await endOwn(invitedToken, identityId, new Date(Date.now() + 86_400_000).toISOString());
      expect(future.status).toBe(400);
      const early = await endOwn(invitedToken, identityId, "2025-12-31T00:00:00.000Z");
      expect(early.status).toBe(422);
      expect(await early.json()).toMatchObject({ error: { code: "IDENTITY_END_DATE_INVALID" } });
      expect(await env.DB.prepare("SELECT ended_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
        ended_at: null,
      });
    });

    it("hides a pending identity from the end path", async () => {
      const pending = await inviteIdentity();
      expect((await endOwn(pending.invitedToken, pending.identityId)).status).toBe(404);
    });

    it("hides another user's identity from the end path", async () => {
      const { identityId } = await acceptedIdentity();
      const other = await insertIndividualMember(env.DB, "H6", "other-end@invitation-lifecycle.example");
      const otherToken = await createMemberSession(
        env.DB,
        other.userId,
        "other-end-session-token",
        undefined,
        other.identityId,
      );
      const response = await endOwn(otherToken, identityId);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_NOT_FOUND" } });
    });

    it("lets a manager end an identity at a past instant and refuses one before it started", async () => {
      const { organizationId, contactToken, identityId, invitedUserId } = await acceptedIdentity();
      const path = `/api/v1/organizations/${organizationId}/identities/${identityId}`;
      const before = await asUser(contactToken, path, {
        method: "PATCH",
        body: JSON.stringify({
          transition: { state: "ended", reason: "Left the organization", endedAt: "2025-06-01T00:00:00.000Z" },
        }),
      });
      expect(before.status).toBe(422);

      const endedAt = "2026-03-01T00:00:00.000Z";
      const response = await asUser(contactToken, path, {
        method: "PATCH",
        body: JSON.stringify({ transition: { state: "ended", reason: "Left the organization", endedAt } }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await env.DB.prepare("SELECT ended_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
        ended_at: endedAt,
      });
      const open = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL",
      )
        .bind(invitedUserId)
        .first<{ total: number }>();
      expect(Number(open?.total)).toBe(0);
    });
  });
});

describe("pending invitation management", () => {
  async function command(
    f: Awaited<ReturnType<typeof inviteIdentity>>,
    token: string,
    action: "cancel" | "activate",
    options: { userId?: string; organizationId?: string; reason?: string } = {},
  ) {
    return callApi(
      env,
      `/api/v1/organizations/${options.organizationId ?? f.organizationId}/identities/${f.identityId}/invitation`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          action,
          userId: options.userId ?? f.invitedUserId,
          ...(action === "activate"
            ? { reason: options.reason ?? "Verified the representative through the organization contact." }
            : {}),
        }),
      },
      { maxRoundTrips: 1 },
    );
  }
  it("lets the organization contact cancel an unaccepted invitation without former experience", async () => {
    const f = await inviteIdentity();
    const token = await deliveredInvitationToken(f.identityId);
    const response = await command(f, f.contactToken, "cancel");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(f.invitedUserId).first()).not.toBeNull();
    expect(
      (
        await callApi(env, "/api/v1/identities/invitations/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        })
      ).status,
    ).not.toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_user_id=? AND status IN ('queued','retrying')",
      )
        .bind(f.invitedUserId)
        .first("count"),
    ).toBe(0);
  });
  it("lets authorized staff activate the same invitation and queues the canonical activation notice", async () => {
    const f = await inviteIdentity();
    const { admin: staff } = await seedEventAndAdmin(env.DB);
    const adminId = staff.id;
    const admin = await createAdminSession(env.DB, adminId, crypto.randomUUID());
    const response = await command(f, admin, "activate");
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await env.DB.prepare("SELECT id,organization_id,user_id,started_at,ended_at FROM identities WHERE id=?")
      .bind(f.identityId)
      .first();
    expect(row).toMatchObject({
      id: f.identityId,
      organization_id: f.organizationId,
      user_id: f.invitedUserId,
      ended_at: null,
    });
    expect(row?.started_at).toBeTruthy();
    const notice = await env.DB.prepare("SELECT recipient_email,payload_json FROM email_outbox WHERE idempotency_key=?")
      .bind(`organization-identity:${f.identityId}:activated:${row!.started_at}`)
      .first<{ recipient_email: string; payload_json: string }>();
    expect(notice?.recipient_email).toBe("invited@invitation-lifecycle.example");
    expect(JSON.parse(notice!.payload_json)).toMatchObject({ organizationName: "Invitation Lifecycle Organization" });
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action='organization_identity_activated'",
    )
      .bind(f.identityId)
      .first<string>("details_json");
    expect(JSON.parse(audit!)).toMatchObject({
      reason: { from: null, to: "Verified the representative through the organization contact." },
    });
    expect((await command(f, admin, "cancel")).status).toBe(409);
  });
  it("refuses activation by an organization contact and requires the staff reason", async () => {
    const f = await inviteIdentity();
    expect((await command(f, f.contactToken, "activate")).status).toBe(409);
    const { admin: staff } = await seedEventAndAdmin(env.DB);
    const adminId = staff.id;
    const admin = await createAdminSession(env.DB, adminId, crypto.randomUUID());
    expect((await command(f, admin, "activate", { reason: "" })).status).toBe(400);
    expect(
      await env.DB.prepare("SELECT started_at FROM identities WHERE id=?").bind(f.identityId).first("started_at"),
    ).toBeNull();
  });
  it("refuses foreign callers, wrong owner snapshots, and a different organization atomically", async () => {
    const f = await inviteIdentity();
    for (const [token, options] of [
      [f.invitedToken, {}],
      [f.contactToken, { userId: crypto.randomUUID() }],
      [f.contactToken, { organizationId: crypto.randomUUID() }],
    ] as const) {
      expect((await command(f, token, "cancel", options)).status).toBe(409);
    }
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first()).not.toBeNull();
  });
});
