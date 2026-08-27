import { env } from "cloudflare:workers";
import { queryAll, seedEventAndAdmin } from "./context";
import app from "../../functions/router";
import { createAdminSession } from "./auth";
import { seedWorkflowEmailTemplates } from "./event-workflow";
import { addProposalSpeaker } from "../../functions/_lib/services/proposals";
import { getEventBySlug } from "../../functions/_lib/services/events";
import {
  confirmRegistrationByToken,
  createRegistration as createRegistrationService,
} from "../../functions/_lib/services/registrations";
import { findOrCreateUser } from "../../functions/_lib/services/users";
import { issueDatabaseCapability } from "../../functions/_lib/services/capability-links";
import { createGroup } from "../../functions/_lib/services/groups";

export async function setupProposalSpeakerCapacityWorkflow(): Promise<{
  eventId: string;
  adminUserId: string;
  adminSessionToken: string;
}> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminUser = (
    await queryAll<{ id: string; email: string }>(env.DB, "SELECT id, email FROM users WHERE role = 'admin' LIMIT 1")
  )[0];
  const group = await createGroup(
    env.DB,
    { identityType: "user", id: adminUser.id, email: adminUser.email, role: "admin" },
    {
      typeKey: "working_group",
      name: `Proposal speaker fixture ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    },
  );
  await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?").bind(group.id, eventId).run();
  await seedWorkflowEmailTemplates(env.DB, adminUser.id);
  const adminSessionToken = await createAdminSession(env.DB, adminUser.id, "test-admin-token");
  return { eventId, adminUserId: adminUser.id, adminSessionToken };
}

export async function inviteSpeakerAndSubmitCapacityProposal(adminSessionToken: string): Promise<{
  speakerManageToken: string;
  proposalId: string;
  coSpeakerUserId: string;
  proposalManageToken: string;
}> {
  const event = (
    await queryAll<{ id: string; owner_group_id: string }>(
      env.DB,
      "SELECT id, owner_group_id FROM events WHERE slug = 'pqc-2026' LIMIT 1",
    )
  )[0];
  const invitationBase = `/api/v1/groups/${event.owner_group_id}/events/${event.id}/invites/speakers`;
  const invites = [{ email: "speaker@example.test", firstName: "Speaker", lastName: "Test", sourceType: "direct" }];
  const previewResponse = await app.fetch(
    new Request(`https://app.test${invitationBase}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
      body: JSON.stringify({ invites }),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
  const preview = (await previewResponse.json()) as { previewToken: string; inviteDigest: string };
  const inviteResponse = await app.fetch(
    new Request(`https://app.test${invitationBase}/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
      body: JSON.stringify({ invites, previewToken: preview.previewToken, inviteDigest: preview.inviteDigest }),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
  if (inviteResponse.status !== 200) throw new Error(`Speaker invite failed: ${inviteResponse.status}`);
  await inviteResponse.json();
  const invite = (
    await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM invites WHERE invitee_email = ? AND invite_type = 'speaker' ORDER BY created_at DESC LIMIT 1",
      "speaker@example.test",
    )
  )[0];
  const inviteToken = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "invite",
    resourceId: invite.id,
  });
  const proposalResponse = await app.fetch(
    new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inviteToken,
        proposer: {
          firstName: "Speaker",
          lastName: "Test",
          email: "speaker@example.test",
          organizationName: "Test Corp",
          jobTitle: "Engineer",
          bio: "Experienced speaker in post-quantum cryptography.",
        },
        proposal: {
          type: "talk",
          title: "Post-Quantum Migration Strategies",
          abstract:
            "A practical guide to migrating enterprise PKI to quantum-safe algorithms covering risk assessment, dual-stack rollout, and governance frameworks.",
        },
        consents: [{ termKey: "speaker-terms", version: "v1" }],
      }),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
  if (proposalResponse.status !== 200) throw new Error(`Proposal submission failed: ${proposalResponse.status}`);
  const { proposalId, manageToken } = (await proposalResponse.json()) as { proposalId: string; manageToken: string };
  const [coSpeakerUser] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'cospeaker@example.test' LIMIT 1",
  );
  const user = coSpeakerUser
    ? { id: coSpeakerUser.id }
    : await findOrCreateUser(env.DB, {
        email: "cospeaker@example.test",
        firstName: "Co",
        lastName: "Speaker",
        organizationName: "Co Corp",
        jobTitle: "CTO",
      });
  const { manageToken: speakerManageToken } = await addProposalSpeaker(env.DB, {
    proposalId,
    userId: user.id,
    role: "co_speaker",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  return { speakerManageToken, proposalId, coSpeakerUserId: user.id, proposalManageToken: manageToken };
}

export async function seedAcceptedSpeakerRegistration(input: {
  eventId: string;
  proposalId: string;
  speakerUserId: string;
}): Promise<string> {
  const event = await getEventBySlug(env.DB, "pqc-2026");
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
     VALUES ('speaker-capacity-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
  )
    .bind(input.eventId)
    .run();
  const holder = await findOrCreateUser(env.DB, {
    email: "speaker-capacity-holder@example.test",
    firstName: "Capacity",
    lastName: "Holder",
  });
  const holderRegistration = await createRegistrationService(env.DB, {
    event,
    userId: holder.id,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "direct",
    confirmationTtlHours: 48,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  await confirmRegistrationByToken(env.DB, {
    token: holderRegistration.confirmationToken as string,
    waitlistClaimWindowHours: 24,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  await env.DB.prepare("UPDATE session_proposals SET status = 'accepted', updated_at = datetime('now') WHERE id = ?")
    .bind(input.proposalId)
    .run();
  const speakerRegistration = await createRegistrationService(env.DB, {
    event,
    userId: input.speakerUserId,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "direct",
    confirmationTtlHours: 48,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const confirmedSpeaker = await confirmRegistrationByToken(env.DB, {
    token: speakerRegistration.confirmationToken as string,
    waitlistClaimWindowHours: 24,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  if (confirmedSpeaker.registration.capacity_exempt_in_person !== 1) {
    throw new Error("Speaker registration was not capacity exempt");
  }
  return speakerRegistration.registration.id;
}

export async function seedPendingSpeakerRegistration(input: {
  eventId: string;
  speakerUserId: string;
}): Promise<string> {
  const event = await getEventBySlug(env.DB, "pqc-2026");
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
     VALUES ('speaker-capacity-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
  )
    .bind(input.eventId)
    .run();
  const holder = await findOrCreateUser(env.DB, {
    email: "speaker-capacity-holder@example.test",
    firstName: "Capacity",
    lastName: "Holder",
  });
  const holderRegistration = await createRegistrationService(env.DB, {
    event,
    userId: holder.id,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "direct",
    confirmationTtlHours: 48,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  await confirmRegistrationByToken(env.DB, {
    token: holderRegistration.confirmationToken as string,
    waitlistClaimWindowHours: 24,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const speakerRegistration = await createRegistrationService(env.DB, {
    event,
    userId: input.speakerUserId,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "direct",
    confirmationTtlHours: 48,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const confirmedSpeaker = await confirmRegistrationByToken(env.DB, {
    token: speakerRegistration.confirmationToken as string,
    waitlistClaimWindowHours: 24,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  if (confirmedSpeaker.registration.capacity_exempt_in_person !== 0) {
    throw new Error("Pending speaker registration unexpectedly has an exemption");
  }
  return speakerRegistration.registration.id;
}
