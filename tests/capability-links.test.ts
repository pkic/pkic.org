import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  authorizeQueuedCapabilityLinks,
  materializeQueuedCapabilityLinks,
  newCapabilityLinkSecret,
  issueDatabaseCapability,
  queuedCapabilityToken,
  signedOrQueuedCapability,
  signCapabilityToken,
  verifyCapabilityToken,
  verifyDatabaseCapability,
} from "../functions/_lib/services/capability-links";
import { resetDb } from "./helpers/reset-db";
import { run } from "../functions/_lib/db/queries";
import { nowIso } from "../functions/_lib/utils/time";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { processSelectedOutbox, queueEmail } from "../functions/_lib/email/outbox";
import { createInvite } from "../functions/_lib/services/invites";

const signingSecret = "capability-test-signing-secret";
const textEncoder = new TextEncoder();

async function seedRegistrationCapability(): Promise<void> {
  const now = nowIso();
  await run(env.DB, "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    "event-capability",
    "event-capability",
    "Capability Event",
    "UTC",
    now,
    now,
  ]);
  await run(
    env.DB,
    "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["user-capability", "user@example.test", "user@example.test", "user", 1, now, now],
  );
  await run(
    env.DB,
    `INSERT INTO registrations (
      id, event_id, user_id, status, attendance_type, source_type,
      manage_link_secret, capacity_exempt_in_person, created_at, updated_at
    ) VALUES (?, ?, ?, 'registered', 'virtual', 'test', ?, 0, ?, ?)`,
    ["registration-capability", "event-capability", "user-capability", newCapabilityLinkSecret(), now, now],
  );
}

describe("public capability links", () => {
  beforeEach(async () => resetDb());

  it("signs purpose-bound, expiring tokens and invalidates them after secret rotation", async () => {
    const linkSecret = newCapabilityLinkSecret();
    const token = await signCapabilityToken({
      signingSecret,
      linkSecret,
      purpose: "registration_manage",
      resourceId: "registration-1",
      ttlSeconds: 60,
      nowSeconds: 1_000,
    });

    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "registration_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: "registration-1" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "proposal_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "registration_manage",
        token,
        nowSeconds: 1_061,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret: newCapabilityLinkSecret(),
        purpose: "registration_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("materializes queued placeholders without persisting a signed token", async () => {
    await seedRegistrationCapability();
    const marker = queuedCapabilityToken("registration_manage", "registration-capability");
    const storedPayload = authorizeQueuedCapabilityLinks(
      { manageUrl: `https://example.test/manage?token=${marker}`, nested: [marker] },
      [marker],
    );

    const materialized = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      storedPayload,
    );
    expect(JSON.stringify(storedPayload)).toContain(marker);
    expect(JSON.stringify(storedPayload)).not.toContain("pkc1_");
    const token = new URL(materialized.manageUrl as string).searchParams.get("token")!;
    expect(token).toMatch(/^pkc1_/);
    expect(materialized.nested).toEqual([token]);
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "registration_manage",
        token,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: "registration-capability" });

    const foldedMarker = `${marker.slice(0, 24)}\r\n ${marker.slice(24)}`;
    const calendarPayload = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      authorizeQueuedCapabilityLinks(
        { ics: `BEGIN:VCALENDAR\r\nURL:https://example.test/manage?token=${foldedMarker}\r\nEND:VCALENDAR\r\n` },
        [foldedMarker],
      ),
    );
    const materializedIcs = calendarPayload.ics as string;
    expect(materializedIcs).not.toContain("pkcq1_");
    const calendarToken = materializedIcs.replace(/\r\n /g, "").match(/token=(pkc1_[A-Za-z0-9._-]+)/)?.[1];
    expect(calendarToken).toBeDefined();
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "registration_manage",
        token: calendarToken!,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: "registration-capability" });
    expect(materializedIcs.split("\r\n").every((line) => textEncoder.encode(line).length <= 75)).toBe(true);
  });

  it("binds queued invite markers to the current secret generation", async () => {
    const now = nowIso();
    await run(
      env.DB,
      `INSERT INTO events
         (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, 'UTC', '2027-12-01T08:00:00.000Z', '2027-12-01T18:00:00.000Z', ?, ?)`,
      ["event-invite-generation", "event-invite-generation", "Invite generation event", now, now],
    );
    const created = await createInvite(env.DB, {
      eventId: "event-invite-generation",
      inviteeEmail: "generation@example.test",
      inviteType: "attendee",
      sourceType: "test",
    });
    const marker = created.token;
    expect(marker).toMatch(/^pkcq1_/);
    const payload = authorizeQueuedCapabilityLinks({ inviteUrl: marker }, [marker]);

    const delivered = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      payload,
    );
    expect(delivered.inviteUrl).toMatch(/^pkc1_/);
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "invite",
        token: delivered.inviteUrl as string,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: created.invite.id });

    const replacementSecret = newCapabilityLinkSecret();
    await run(env.DB, "UPDATE invites SET link_secret = ? WHERE id = ?", [replacementSecret, created.invite.id]);
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });

    const directMarker = await signedOrQueuedCapability({
      linkSecret: replacementSecret,
      purpose: "invite",
      resourceId: created.invite.id,
    });
    expect(directMarker).toMatch(/^pkcq1_/);
    await expect(
      materializeQueuedCapabilityLinks(
        env.DB,
        { INTERNAL_SIGNING_SECRET: signingSecret },
        authorizeQueuedCapabilityLinks({ inviteUrl: directMarker }, [directMarker]),
      ),
    ).resolves.toMatchObject({ inviteUrl: expect.stringMatching(/^pkc1_/) });
  });

  it("materializes only explicitly authorized queued markers", async () => {
    await seedRegistrationCapability();
    const authorizedMarker = queuedCapabilityToken("registration_manage", "registration-capability");
    const injectedMarker = queuedCapabilityToken("registration_manage", "attacker-selected-resource");
    const payload = authorizeQueuedCapabilityLinks(
      {
        manageUrl: `https://example.test/manage?token=${authorizedMarker}`,
        firstName: injectedMarker,
      },
      [authorizedMarker],
    );

    const materialized = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      payload,
    );

    expect(materialized.manageUrl).toMatch(/token=pkc1_/);
    expect(materialized.firstName).toBe(injectedMarker);
    expect(materialized).not.toHaveProperty("__authorizedCapabilityMarkers");
  });

  it("reports an authorized marker whose resource is no longer available as stale", async () => {
    const marker = queuedCapabilityToken("registration_manage", "missing-registration");
    const payload = authorizeQueuedCapabilityLinks({ manageUrl: marker }, [marker]);

    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
    ).rejects.toMatchObject({
      status: 410,
      code: "CAPABILITY_RESOURCE_STALE",
      details: { purpose: "registration_manage", resourceId: "missing-registration" },
    });
  });

  it.each([
    ["accepted", null],
    ["declined", null],
    ["revoked", null],
    ["expired", null],
    ["sent", "2000-01-01T00:00:00.000Z"],
  ])("does not materialize an invite that is %s", async (status, expiresAt) => {
    const inviteId = crypto.randomUUID();
    const linkSecret = newCapabilityLinkSecret();
    const now = nowIso();
    await run(
      env.DB,
      "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, 'UTC', ?, ?)",
      [inviteId, inviteId, "Invite capability test", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO invites (id, event_id, invitee_email, invite_type, link_secret, status, expires_at, source_type, created_at)
       VALUES (?, ?, ?, 'attendee', ?, ?, ?, 'test', ?)`,
      [inviteId, inviteId, `${inviteId}@example.test`, linkSecret, status, expiresAt, now],
    );
    const marker = queuedCapabilityToken("invite", inviteId, undefined, await sha256Hex(linkSecret));
    const payload = authorizeQueuedCapabilityLinks({ url: marker }, [marker]);
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });
  });

  it("permanently skips a queued email and records the stale capability resource", async () => {
    await seedRegistrationCapability();
    const marker = queuedCapabilityToken("registration_manage", "registration-capability");
    const manageUrl = `https://example.test/manage?token=${marker}`;
    const outboxId = await queueEmail(env.DB, {
      eventId: "event-capability",
      templateKey: "unused-for-stale-capability",
      recipientEmail: "user@example.test",
      messageType: "transactional",
      capabilityLinkValues: [manageUrl],
      data: { manageUrl },
    });
    await run(env.DB, "DELETE FROM registrations WHERE id = ?", ["registration-capability"]);

    await expect(
      processSelectedOutbox(env.DB, { ...env, INTERNAL_SIGNING_SECRET: signingSecret }, [outboxId]),
    ).resolves.toMatchObject({ processed: 1, failed: 1, skipped: 0 });
    const outbox = await env.DB.prepare("SELECT status, attempts, last_error FROM email_outbox WHERE id = ?")
      .bind(outboxId)
      .first<{ status: string; attempts: number; last_error: string }>();
    expect(outbox).toMatchObject({ status: "cancelled", attempts: 1 });
    expect(outbox?.last_error).toContain("CAPABILITY_RESOURCE_STALE");
    expect(outbox?.last_error).toContain("registration-capability");
  });

  it("initializes a legacy speaker secret with Web Crypto when first issuing a link", async () => {
    const now = nowIso();
    await run(
      env.DB,
      "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["event-speaker", "event-speaker", "Speaker Event", "UTC", now, now],
    );
    await run(
      env.DB,
      "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["user-speaker", "speaker@example.test", "speaker@example.test", "user", 1, now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        manage_link_secret, submitted_at, updated_at
      ) VALUES (?, ?, ?, 'submitted', 'talk', 'Talk', 'Abstract', ?, ?, ?)`,
      ["proposal-speaker", "event-speaker", "user-speaker", newCapabilityLinkSecret(), now, now],
    );
    await run(
      env.DB,
      `INSERT INTO proposal_speakers (
        id, proposal_id, user_id, role, status, manage_link_secret, created_at
      ) VALUES (?, ?, ?, 'speaker', 'invited', NULL, ?)`,
      ["speaker-legacy", "proposal-speaker", "user-speaker", now],
    );

    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "speaker_manage",
      resourceId: "speaker-legacy",
    });
    const row = await env.DB.prepare("SELECT manage_link_secret FROM proposal_speakers WHERE id = ?")
      .bind("speaker-legacy")
      .first<{ manage_link_secret: string | null }>();

    expect(row?.manage_link_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      verifyDatabaseCapability({ db: env.DB, signingSecret, purpose: "speaker_manage", token }),
    ).resolves.toMatchObject({ ok: true, resourceId: "speaker-legacy" });
  });

  it("applies the consolidated schema migration without retaining obsolete token columns", async () => {
    const registrationColumns = await env.DB.prepare("PRAGMA table_info(registrations)").all<{ name: string }>();
    const speakerColumns = await env.DB.prepare("PRAGMA table_info(proposal_speakers)").all<{ name: string }>();

    expect(registrationColumns.results.map((column: { name: string }) => column.name)).toEqual(
      expect.arrayContaining(["confirmation_link_secret", "manage_link_secret"]),
    );
    expect(registrationColumns.results.map((column: { name: string }) => column.name)).not.toEqual(
      expect.arrayContaining(["confirmation_token_hash", "confirmation_token_expires_at", "manage_token_hash"]),
    );
    expect(speakerColumns.results.map((column: { name: string }) => column.name)).toContain("manage_link_secret");
    expect(speakerColumns.results.map((column: { name: string }) => column.name)).not.toContain("manage_token_hash");
  });
});
