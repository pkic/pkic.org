import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { createProposal } from "../functions/_lib/services/proposals";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  confirmRegistrationByToken,
  createRegistration,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";
import {
  createReferralCode,
  recordReferralClick,
  recordReferralConversion,
} from "../functions/_lib/services/referrals";
import { recordPromotionDownload } from "../functions/_lib/services/event-agenda/promotion-access";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { issueBadge, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { nowIso } from "../functions/_lib/utils/time";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { resetDb } from "./helpers/reset-db";

const signingSecret = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret";

async function register(eventId: string, email: string, referredByCode?: string) {
  const user = await findOrCreateUser(env.DB, { email, firstName: "Synthetic", lastName: "Participant" });
  const created = await createRegistration(env.DB, {
    event: { id: eventId },
    userId: user.id,
    attendanceType: "virtual",
    sourceType: "web",
    referredByCode,
    signingSecret,
    confirmationTtlHours: 24,
  });
  return { user, ...created };
}

async function confirm(created: Awaited<ReturnType<typeof createRegistration>>) {
  if (!created.confirmationToken) throw new Error("Expected a real pending-registration confirmation token");
  return confirmRegistrationByToken(env.DB, {
    token: created.confirmationToken,
    signingSecret,
    waitlistClaimWindowHours: 24,
  });
}

async function setup() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  // The approved roster contains two on-site speakers; the shared seed has only one seat.
  await env.DB.prepare("UPDATE events SET capacity_in_person=2 WHERE id=?").bind(eventId).run();
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  if (!admin) throw new Error("Expected the canonical event administrator fixture");
  const adminToken = await createAdminSession(env.DB, admin.id, "promotion-metrics-admin");
  const owner = await register(eventId, "kit-owner@example.com");
  const coOwner = await register(eventId, "kit-co-owner@example.com");
  await confirm(owner);
  await confirm(coOwner);
  const ownerToken = await createAdminSession(env.DB, owner.user.id, "promotion-metrics-owner");
  const coOwnerToken = await createAdminSession(env.DB, coOwner.user.id, "promotion-metrics-co-owner");
  const base = "/api/v1/events/pqc-2026/agenda";
  async function post(path: string, body: unknown) {
    const response = await callApi(env, `${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  }
  let agenda = await post("/occurrences", {
    expectedRevision: 0,
    title: "Canonical promotion metrics",
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T10:00:00.000Z",
    roomId: null,
    admissionPolicy: "reservation",
    speakerUserIds: [owner.user.id, coOwner.user.id],
  });
  const occurrenceId = agenda.occurrences[0]!.id;
  const resource = `/occurrences/${occurrenceId}`;
  agenda = await post(`${resource}/history`, {
    expectedRevision: agenda.revision,
    history: {
      appearances: [owner, coOwner].map(({ user }) =>
        individualAppearanceFixture({ userId: user.id, displayName: user.email, approvedAt: nowIso() }),
      ),
    },
  });
  agenda = await post(`${resource}/promotion`, {
    expectedRevision: agenda.revision,
    copy: {
      whyAttend: "Learn how canonical registration status stays distinct from referral activity.",
      takeaways: ["Understand verified registration counts", "Keep promotion activity metrics distinct"],
      callToAction: "Register for the event",
      campaign: "speaker-kit",
      approvedAt: nowIso(),
    },
  });
  agenda = await post("/publications", { expectedRevision: agenda.revision });
  // An organizer may issue the owner's code; ownership is not the creator's identity.
  const code = await createReferralCode(env.DB, {
    eventId,
    ownerType: "registration",
    ownerId: owner.registration.id,
    createdByUserId: admin.id,
    channelHint: "speaker-kit",
    length: 10,
  });
  return {
    eventId,
    occurrenceId,
    revision: agenda.revision,
    admin,
    adminToken,
    owner,
    coOwner,
    ownerToken,
    coOwnerToken,
    code,
    path: `${base}${resource}/promotion`,
  };
}

let fixture: Awaited<ReturnType<typeof setup>>;

async function readKit(token = fixture.ownerToken) {
  const response = await callApi(env, fixture.path, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  const kit = promotionKitSchema.parse(body);
  expect(body).toEqual(kit);
  return kit;
}

async function referralTotals(code = fixture.code) {
  return env.DB.prepare("SELECT clicks,conversions FROM referral_codes WHERE code=?")
    .bind(code)
    .first<{ clicks: number; conversions: number }>();
}

describe("promotion confirmed registration metrics", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
    fixture = await setup();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows real pending, confirmation, cancellation and reactivation state without changing receipt history", async () => {
    const referred = await register(fixture.eventId, "referred-attendee@example.com", fixture.code);
    expect(referred.registration.status).toBe("pending_email_confirmation");
    expect(referred.registration.confirmed_at).toBeNull();
    expect(await referralTotals()).toMatchObject({ conversions: 1 });
    expect((await readKit()).metrics.confirmedRegistrations).toBe(0);

    await confirm(referred);
    expect((await readKit()).metrics.confirmedRegistrations).toBe(1);
    await recordReferralConversion(env.DB, fixture.code, { type: "registration", ref: referred.registration.id });
    await expect(confirm(referred)).rejects.toMatchObject({ code: "CONFIRM_TOKEN_INVALID" });
    expect((await readKit()).metrics.confirmedRegistrations).toBe(1);
    expect(await referralTotals()).toMatchObject({ conversions: 1 });

    await updateRegistrationById(
      env.DB,
      { eventId: fixture.eventId, registrationId: referred.registration.id, action: "cancel" },
      "admin",
    );
    expect((await readKit()).metrics.confirmedRegistrations).toBe(0);
    const reactivated = await register(fixture.eventId, referred.user.email, fixture.code);
    expect(reactivated.reactivated).toBe(true);
    expect(reactivated.registration.id).toBe(referred.registration.id);
    expect((await readKit()).metrics.confirmedRegistrations).toBe(0);
    await confirm(reactivated);
    expect((await readKit()).metrics.confirmedRegistrations).toBe(1);
    expect(await referralTotals()).toMatchObject({ conversions: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM referral_conversions WHERE code=?")
        .bind(fixture.code)
        .first("count"),
    ).toBe(1);
  });

  it("excludes proposal receipts, foreign events, other owners and registrations without this code's receipt", async () => {
    const referred = await register(fixture.eventId, "selected-code@example.com", fixture.code);
    await confirm(referred);
    const organic = await register(fixture.eventId, "no-referral@example.com");
    await confirm(organic);
    const proposal = await createProposal(env.DB, {
      eventId: fixture.eventId,
      proposerUserId: organic.user.id,
      proposalType: "talk",
      title: "A separately attributed proposal",
      abstract: "Proposal conversion history must never be relabeled as confirmed event registrations.",
      referredByCode: fixture.code,
      signingSecret,
    });
    const otherEventId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
    )
      .bind(otherEventId, "other-promotion-event", "Other event", at, at)
      .run();
    const foreign = await register(otherEventId, "foreign-event@example.com", fixture.code);
    await confirm(foreign);
    const coOwnerCode = await createReferralCode(env.DB, {
      eventId: fixture.eventId,
      ownerType: "registration",
      ownerId: fixture.coOwner.registration.id,
      createdByUserId: fixture.owner.user.id,
      channelHint: "speaker-kit",
      length: 10,
    });
    const otherOwnerReferral = await register(fixture.eventId, "other-code@example.com", coOwnerCode);
    await confirm(otherOwnerReferral);

    const kit = await readKit();
    expect(new URL(kit.registrationUrl).pathname).toBe(`/r/${fixture.code}`);
    expect(kit.metrics.confirmedRegistrations).toBe(1);
    expect(await referralTotals()).toMatchObject({ conversions: 3 });
    const otherKit = await readKit(fixture.coOwnerToken);
    expect(new URL(otherKit.registrationUrl).pathname).toBe(`/r/${coOwnerCode}`);
    expect(otherKit.metrics.confirmedRegistrations).toBe(1);
    expect(await referralTotals(coOwnerCode)).toMatchObject({ conversions: 1 });
    expect(
      await env.DB.prepare("SELECT conversion_type FROM referral_conversions WHERE code=? AND conversion_ref=?")
        .bind(fixture.code, proposal.proposal.id)
        .first(),
    ).toEqual({ conversion_type: "proposal" });
  });

  it("keeps clicks, downloads, RSVP and recorded attendance distinct from confirmed referral registrations", async () => {
    const attendee = await register(fixture.eventId, "activity-only@example.com");
    await confirm(attendee);
    await recordReferralClick(env.DB, {
      code: fixture.code,
      ip: null,
      userAgent: null,
      secret: signingSecret,
    });
    await recordPromotionDownload(env.DB, fixture.occurrenceId, fixture.owner.user.id, "square");
    const reservation = await setSessionParticipation(env.DB, fixture.eventId, fixture.occurrenceId, attendee.user.id, {
      action: "reserve",
      attendanceMode: "remote",
    });
    expect(reservation.status).toBe("reserved");
    const badge = await issueBadge(
      env.DB,
      fixture.eventId,
      fixture.admin.id,
      {
        userId: attendee.user.id,
        operationId: crypto.randomUUID(),
      },
      env,
    );
    const receipt = await recordScan(
      env.DB,
      fixture.eventId,
      { operatorUserId: fixture.admin.id, canScan: true, canAdmitExceptions: false },
      eventScanRequestSchema.parse({
        operatorUserId: fixture.admin.id,
        operationId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        badgeId: badge.credential,
        occurrenceId: fixture.occurrenceId,
        action: "attendance",
        observedAt: nowIso(),
        capturePublicationRevision: fixture.revision,
      }),
    );
    expect(receipt.attendanceRecorded).toBe(true);
    const kit = await readKit();
    expect(kit.metrics).toEqual({ clicks: 1, downloads: 1, confirmedRegistrations: 0, sessionRsvps: 1 });
    const serialized = JSON.stringify(kit);
    for (const privateValue of [attendee.user.email, attendee.user.id, attendee.registration.id, badge.credential])
      expect(serialized).not.toContain(privateValue);
    expect(await referralTotals()).toMatchObject({ clicks: 1, conversions: 0 });
  });

  it("requires a live session and assigned speaker or event management authority and returns aggregate-only metrics", async () => {
    expect((await callApi(env, fixture.path)).status).toBe(401);
    const unassigned = await register(fixture.eventId, "unassigned-operator@example.com");
    await confirm(unassigned);
    const token = await createAdminSession(env.DB, unassigned.user.id, "promotion-unassigned");
    expect((await callApi(env, fixture.path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    const ownerKit = await readKit();
    const managerKit = await readKit(fixture.adminToken);
    expect(Object.keys(ownerKit.metrics).sort()).toEqual([
      "clicks",
      "confirmedRegistrations",
      "downloads",
      "sessionRsvps",
    ]);
    expect(managerKit.metrics.confirmedRegistrations).toBe(0);
    const serialized = JSON.stringify(ownerKit);
    for (const privateValue of [
      unassigned.user.email,
      unassigned.user.id,
      unassigned.registration.id,
      fixture.owner.registration.manage_link_secret,
      fixture.ownerToken,
    ])
      expect(serialized).not.toContain(privateValue);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(nowIso(), fixture.owner.user.id)
      .run();
    expect(
      (await callApi(env, fixture.path, { headers: { authorization: `Bearer ${fixture.ownerToken}` } })).status,
    ).toBe(401);
  });
});
