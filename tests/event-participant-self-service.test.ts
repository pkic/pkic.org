import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin, deliveredEmailPayload } from "./helpers/context";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createProposal, getProposalById, updateProposalForVerifiedOwner } from "../functions/_lib/services/proposals";
import { registrationManageReadResponseSchema } from "../assets/shared/schemas/registration";
import { proposalAccessReadResponseSchema } from "../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";

beforeEach(resetDb);

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const owner = await insertUser(env.DB, "participant-owner@example.test");
  const speaker = await insertUser(env.DB, "participant-speaker@example.test");
  const { userId: stranger } = await insertIndividualMember(env.DB, "H6", "participant-stranger@example.test");
  const tokens = await Promise.all(
    [owner, speaker, stranger].map((id) => createMemberSession(env.DB, id, crypto.randomUUID())),
  );
  const registrationId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at) VALUES (?, ?, ?, 'registered', 'virtual', 'self_service', ?, ?, ?)",
  )
    .bind(registrationId, eventId, owner, crypto.randomUUID(), new Date().toISOString(), new Date().toISOString())
    .run();
  const { proposal } = await createProposal(env.DB, {
    eventId,
    proposerUserId: owner,
    proposalType: "talk",
    title: "Participant proposal",
    abstract: "A sufficiently detailed proposal abstract for testing participant ownership and lifecycle restrictions.",
  });
  await env.DB.prepare(
    "INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, manage_link_secret, created_at) VALUES (?, ?, ?, 'speaker', 'confirmed', ?, ?)",
  )
    .bind(crypto.randomUUID(), proposal.id, speaker, crypto.randomUUID(), new Date().toISOString())
    .run();
  return { eventId, owner, speaker, tokens, registrationId, proposalId: proposal.id };
}

function request(path: string, token?: string, body?: unknown) {
  return callApi(env, path, {
    method: body === undefined ? "GET" : "PATCH",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("session-owned event participation", () => {
  it("reads only the identity's registration without issuing a capability", async () => {
    const f = await fixture();
    const path = `/api/v1/registrations/${f.registrationId}`;
    const response = await request(path, f.tokens[0]);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = registrationManageReadResponseSchema.parse(await response.json());
    expect(body.registration.id).toBe(f.registrationId);
    expect(JSON.stringify(body)).not.toMatch(/manageToken|manage_link_secret|\/access\//);
    expect((await request(path)).status).toBe(401);
    expect((await request(path, f.tokens[1])).status).toBe(404);
    expect((await request(path, f.tokens[1], { action: "cancel" })).status).toBe(404);
  });

  it("establishes an event-only session through the real email verification route", async () => {
    const f = await fixture();
    const sent = await callApi(env, "/api/v1/auth/request-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "participant-owner@example.test" }),
    });
    expect(sent.status).toBe(200);
    const outbox = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key = 'user_magic_link' ORDER BY rowid DESC LIMIT 1",
    ).first<{ payload_json: string }>();
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox!.payload_json);
    const token = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
    const verified = await callApi(env, "/api/v1/auth/verify-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(await verified.json()).toMatchObject({ identity: { id: f.owner }, eventParticipation: true });
    const session = await callApi(env, "/api/v1/auth/session", {
      headers: { cookie: verified.headers.get("set-cookie")!.split(";")[0] },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as Record<string, unknown>;
    expect(body.eventParticipation).toBe(true);
    expect(body.staff).toBeUndefined();
    expect(body.member).toBeUndefined();
  });

  it("preserves registration verification, cancellation and restore rules", async () => {
    const f = await fixture();
    const path = `/api/v1/registrations/${f.registrationId}`;
    const update = await request(path, f.tokens[0], { action: "update", firstName: "Updated attendee" });
    expect(update.status, await update.clone().text()).toBe(200);
    let view = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(view.user.first_name).toBe("Updated attendee");
    expect(view.registration.isEmailVerified).toBe(false);
    expect((await request(path, f.tokens[0], { action: "cancel" })).status).toBe(200);
    const restore = await request(path, f.tokens[0], { action: "update" });
    // Unverified identities cannot recover a confirmed seat merely by signing in.
    expect(restore.status).toBe(200);
    view = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(view.registration.status).toBe("pending_email_confirmation");
    const recovery = await callApi(env, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "participant-owner@example.test" }),
    });
    expect(recovery.status, await recovery.clone().text()).toBe(200);
    const email = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY rowid DESC LIMIT 1",
    ).first<{ payload_json: string }>();
    const delivered = await deliveredEmailPayload<{ confirmationUrl: string }>(env.DB, env, email!.payload_json);
    expect(new URL(delivered.confirmationUrl).searchParams.get("token")).toMatch(/^pkc1_/);
    await env.DB.prepare("UPDATE registrations SET confirmed_at = ?, status = 'cancelled' WHERE id = ?")
      .bind(new Date().toISOString(), f.registrationId)
      .run();
    expect((await request(path, f.tokens[0], { action: "update" })).status).toBe(200);
    view = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(view.registration.status).toBe("registered");
    expect((await request(path, f.tokens[0], { action: "update", email: "invalid" })).status).toBe(400);
    await env.DB.prepare(
      "UPDATE registrations SET status = 'cancelled', cancellation_reason_code = 'unauthorized_registration' WHERE id = ?",
    )
      .bind(f.registrationId)
      .run();
    expect((await request(path, f.tokens[0], { action: "update" })).status).toBe(409);
  });

  it("keeps day capacity and waitlist claims authoritative for owner edits", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at) VALUES (?, ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId)
      .run();
    const holder = await insertUser(env.DB, "seat-holder@example.test");
    const holderRegistration = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, 'registered', 'in_person', 'self_service', ?, datetime('now'), datetime('now'), datetime('now'))",
    )
      .bind(holderRegistration, f.eventId, holder, crypto.randomUUID())
      .run();
    const holderToken = await createMemberSession(env.DB, holder, crypto.randomUUID());
    const dayAttendance = [{ dayDate: "2026-12-01", attendanceType: "in_person" }];
    expect(
      (await request(`/api/v1/registrations/${holderRegistration}`, holderToken, { action: "update", dayAttendance }))
        .status,
    ).toBe(200);
    const path = `/api/v1/registrations/${f.registrationId}`;
    const changed = await request(path, f.tokens[0], { action: "update", dayAttendance });
    expect(changed.status, await changed.clone().text()).toBe(200);
    const view = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(view.dayWaitlist).toEqual(
      expect.arrayContaining([expect.objectContaining({ dayDate: "2026-12-01", status: "waiting" })]),
    );
    expect(
      (await request(path, f.tokens[0], { action: "update", dayAttendance, claimDayWaitlistOffers: ["2026-12-01"] }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(path, f.tokens[0], {
          action: "update",
          dayAttendance: [{ dayDate: "2026-12-09", attendanceType: "in_person" }],
        })
      ).status,
    ).toBe(400);
    await env.DB.prepare("UPDATE registrations SET confirmed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), f.registrationId)
      .run();
    expect((await request(path, f.tokens[0], { action: "cancel" })).status).toBe(200);
    expect((await request(path, f.tokens[0], { action: "update" })).status).toBe(200);
    const restored = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(restored.dayWaitlist).toEqual(
      expect.arrayContaining([expect.objectContaining({ dayDate: "2026-12-01", status: "waiting" })]),
    );
  });

  it("anchors proposal edit auditing to the proposal update, not optional answer mutations", async () => {
    const f = await fixture();
    const proposal = await getProposalById(env.DB, f.proposalId);
    const saved = await updateProposalForVerifiedOwner(env.DB, proposal, {
      action: "update",
      title: "Saved with optional answers",
      formSubmissionStatements: [
        env.DB.prepare("DELETE FROM form_submission_answers WHERE submission_id = ?").bind("absent-optional-answer"),
      ],
    });
    expect(saved.title).toBe("Saved with optional answers");
    await expect(
      updateProposalForVerifiedOwner(env.DB, proposal, {
        action: "update",
        title: "Stale write",
        formSubmissionStatements: [
          env.DB.prepare("UPDATE users SET first_name = 'Must roll back' WHERE id = ?").bind(f.owner),
        ],
      }),
    ).rejects.toThrow("Proposal changed");
    expect(
      await env.DB.prepare("SELECT first_name FROM users WHERE id = ?").bind(f.owner).first("first_name"),
    ).not.toBe("Must roll back");
  });

  it("keeps email changes pending without reassigning registration ownership", async () => {
    const f = await fixture();
    const path = `/api/v1/registrations/${f.registrationId}`;
    const response = await request(path, f.tokens[0], { action: "update", email: "new-participant@example.test" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ emailChanged: true });
    const view = registrationManageReadResponseSchema.parse(await (await request(path, f.tokens[0])).json());
    expect(view.user.email).toBe("participant-owner@example.test");
    expect(view.registration.status).toBe("pending_email_confirmation");
    expect(
      await env.DB.prepare("SELECT user_id FROM registrations WHERE id = ?").bind(f.registrationId).first("user_id"),
    ).toBe(f.owner);
    expect((await request(path, f.tokens[2])).status).toBe(404);
  });

  it("denies another identity's speaker files and consent mutations", async () => {
    const f = await fixture();
    const base = `/api/v1/proposals/${f.proposalId}/participation`;
    for (const token of [undefined, f.tokens[2]]) {
      for (const suffix of ["/headshot", "/presentation"])
        expect((await request(base + suffix, token)).status).toBe(token ? 404 : 401);
      expect((await request(base, token, { status: "declined" })).status).toBe(token ? 404 : 401);
    }
  });

  it("does not give participants organizer access", async () => {
    const f = await fixture();
    for (const token of f.tokens.slice(0, 2)) {
      expect((await request(`/api/v1/proposals/${f.proposalId}`, token)).status).toBe(403);
    }
  });

  it("keeps proposer access separate from speaker and stranger access", async () => {
    const f = await fixture();
    const path = `/api/v1/proposals/${f.proposalId}/submission`;
    const response = await request(path, f.tokens[0]);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = proposalAccessReadResponseSchema.parse(await response.json());
    expect(body.proposal.proposer_user_id).toBe(f.owner);
    expect(JSON.stringify(body)).not.toMatch(/manageToken|manage_link_secret|\/access\//);
    for (const token of [undefined, f.tokens[1], f.tokens[2]]) {
      expect((await request(path, token)).status).toBe(token ? 404 : 401);
      expect((await request(path, token, { title: "Unauthorized change" })).status).toBe(token ? 404 : 401);
    }
    const update = await request(path, f.tokens[0], { title: "Updated by submitter" });
    expect(update.status, await update.clone().text()).toBe(200);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(f.proposalId).run();
    expect((await request(path, f.tokens[0], { title: "Not editable" })).status).toBe(409);
  });

  it("reads and edits only the caller's own speaker profile", async () => {
    const f = await fixture();
    const path = `/api/v1/proposals/${f.proposalId}/participation`;
    const response = await request(path, f.tokens[1]);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = speakerSelfServiceReadResponseSchema.parse(await response.json());
    expect(body.profile.email).toBe("participant-speaker@example.test");
    expect(body.proposal.presentationUrl).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/manageToken|manage_link_secret|\/access\//);
    expect((await request(path, f.tokens[0])).status).toBe(404);
    expect((await request(path, f.tokens[2])).status).toBe(404);
    const update = await request(path + "/profile", f.tokens[1], { biography: "Updated speaker biography." });
    expect(update.status, await update.clone().text()).toBe(200);
    expect((await request(path + "/profile", f.tokens[2], { biography: "Unauthorized" })).status).toBe(404);
    await env.DB.prepare("UPDATE session_proposals SET status = 'withdrawn' WHERE id = ?").bind(f.proposalId).run();
    expect((await request(path + "/profile", f.tokens[1], { biography: "Closed" })).status).toBe(409);
  });
});
