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
import { buildAddProposalSpeaker, queuedSpeakerManageToken } from "../functions/_lib/services/proposal-speakers";
import { resetDb } from "./helpers/reset-db";
import { run } from "../functions/_lib/db/queries";
import { nowIso } from "../functions/_lib/utils/time";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { processSelectedOutbox, queueEmail } from "../functions/_lib/email/outbox";
import {
  prepareBulkQueueEmailChunkStatements,
  prepareBulkQueueEmailStatements,
} from "../functions/_lib/email/outbox-queue";
import { createInvite } from "../functions/_lib/services/invites";
import { prepareRotateUserProposalSpeakerManageSecrets } from "../functions/_lib/services/registrations/manage-capability-revocation";

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

async function seedSpeakerCapability(): Promise<void> {
  const now = nowIso();
  const startsAt = new Date(Date.now() + 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 172_800_000).toISOString();
  await run(
    env.DB,
    "INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["event-speaker", "event-speaker", "Speaker Event", "UTC", startsAt, endsAt, now, now],
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
      id, proposal_id, user_id, role, status, manage_link_secret, invite_expires_at, created_at
    ) VALUES (?, ?, ?, 'speaker', 'invited', ?, ?, ?)`,
    ["speaker-capability", "proposal-speaker", "user-speaker", newCapabilityLinkSecret(), startsAt, now],
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

  it("binds queued speaker capabilities to the recipient's current canonical email", async () => {
    await seedSpeakerCapability();
    expect(() => queuedCapabilityToken("speaker_manage", "speaker-capability")).toThrow(
      "Queued speaker capabilities must be bound to the current link secret",
    );
    const marker = await queuedSpeakerManageToken(env.DB, "speaker-capability");
    const unboundPayload = authorizeQueuedCapabilityLinks({ manageUrl: marker }, [marker]);
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, unboundPayload),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });

    const outboxId = await queueEmail(env.DB, {
      eventId: "event-speaker",
      templateKey: "unused-speaker-capability",
      recipientUserId: "user-speaker",
      recipientEmail: "Speaker@Example.Test",
      messageType: "transactional",
      capabilityLinkValues: [marker],
      data: { manageUrl: marker },
    });
    const queued = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
      .bind(outboxId)
      .first<{ payload_json: string }>();
    const storedPayload = JSON.parse(queued!.payload_json) as Record<string, unknown>;
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, storedPayload),
    ).resolves.toMatchObject({ manageUrl: expect.stringMatching(/^pkc1_/) });

    await run(env.DB, "UPDATE users SET email = ?, normalized_email = ? WHERE id = ?", [
      "new-speaker@example.test",
      "new-speaker@example.test",
      "user-speaker",
    ]);
    await run(
      env.DB,
      "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["old-email-owner", "speaker@example.test", "speaker@example.test", "user", 1, nowIso(), nowIso()],
    );
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, storedPayload),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });

    const freshPayload = authorizeQueuedCapabilityLinks({ manageUrl: marker }, [marker], {
      recipientEmail: "new-speaker@example.test",
    });
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, freshPayload),
    ).resolves.toMatchObject({ manageUrl: expect.stringMatching(/^pkc1_/) });
  });

  it("rejects a queued speaker marker after same-email secret rotation and declined re-invite", async () => {
    await seedSpeakerCapability();
    const secret = await env.DB.prepare("SELECT manage_link_secret FROM proposal_speakers WHERE id = ?")
      .bind("speaker-capability")
      .first<{ manage_link_secret: string }>();
    const marker = await queuedSpeakerManageToken(env.DB, "speaker-capability", secret?.manage_link_secret);
    const payload = authorizeQueuedCapabilityLinks({ manageUrl: marker }, [marker], {
      recipientEmail: "speaker@example.test",
    });
    const outboxId = await queueEmail(env.DB, {
      eventId: "event-speaker",
      templateKey: "unused-speaker-rotation",
      recipientUserId: "user-speaker",
      recipientEmail: "speaker@example.test",
      messageType: "transactional",
      capabilityLinkValues: [marker],
      data: payload,
    });

    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE id = ?")
      .bind("speaker-capability")
      .run();
    const storedBeforeReinvite = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
      .bind(outboxId)
      .first<{ payload_json: string }>();
    await expect(
      materializeQueuedCapabilityLinks(
        env.DB,
        { INTERNAL_SIGNING_SECRET: signingSecret },
        JSON.parse(storedBeforeReinvite!.payload_json),
      ),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });
    const reinvited = await buildAddProposalSpeaker(env.DB, {
      proposalId: "proposal-speaker",
      userId: "user-speaker",
      role: "speaker",
    });
    await env.DB.batch(reinvited.statements);

    const stored = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
      .bind(outboxId)
      .first<{ payload_json: string }>();
    await expect(
      materializeQueuedCapabilityLinks(
        env.DB,
        { INTERNAL_SIGNING_SECRET: signingSecret },
        JSON.parse(stored!.payload_json),
      ),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });
  });

  it("rejects delivery after an invited speaker deadline but keeps confirmed delivery available", async () => {
    await seedSpeakerCapability();
    const startsAt = new Date(Date.now() - 120_000).toISOString();
    const endsAt = new Date(Date.now() + 120_000).toISOString();
    await env.DB.prepare("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind(startsAt, endsAt, "event-speaker")
      .run();
    await env.DB.prepare("UPDATE proposal_speakers SET invite_expires_at = ? WHERE id = ?")
      .bind(startsAt, "speaker-capability")
      .run();
    const secret = await env.DB.prepare("SELECT manage_link_secret FROM proposal_speakers WHERE id = ?")
      .bind("speaker-capability")
      .first<{ manage_link_secret: string }>();
    const marker = await queuedSpeakerManageToken(env.DB, "speaker-capability", secret?.manage_link_secret);
    const payload = authorizeQueuedCapabilityLinks({ manageUrl: marker }, [marker], {
      recipientEmail: "speaker@example.test",
    });
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
    ).rejects.toMatchObject({ status: 410, code: "CAPABILITY_RESOURCE_STALE" });

    await env.DB.prepare("UPDATE proposal_speakers SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
      .bind(startsAt, "speaker-capability")
      .run();
    await expect(
      materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
    ).resolves.toMatchObject({ manageUrl: expect.stringMatching(/^pkc1_/) });
  });

  it("binds speaker recipients in both non-chunked and chunked bulk outbox paths", async () => {
    await seedSpeakerCapability();
    const marker = await queuedSpeakerManageToken(env.DB, "speaker-capability");
    const baseRow = {
      eventId: "event-speaker",
      recipientEmail: "Speaker@Example.Test",
      recipientUserId: "user-speaker",
      templateKey: "unused-bulk-speaker-capability",
      subject: "Speaker capability",
      capabilityLinkValues: [marker],
      data: { manageUrl: marker },
      messageType: "transactional" as const,
    };
    const direct = prepareBulkQueueEmailStatements(env.DB, [{ ...baseRow, outboxId: "speaker-bulk-direct" }]);
    const chunked = prepareBulkQueueEmailChunkStatements(env.DB, [{ ...baseRow, outboxId: "speaker-bulk-chunked" }]);
    await env.DB.batch([...direct.map((row) => row.statement), ...chunked.map((chunk) => chunk.statement)]);

    const rows = await env.DB.prepare("SELECT id, payload_json FROM email_outbox WHERE id IN (?, ?) ORDER BY id")
      .bind("speaker-bulk-direct", "speaker-bulk-chunked")
      .all<{ id: string; payload_json: string }>();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      expect(payload.__authorizedCapabilityMarkers).toEqual([
        { marker, recipientNormalizedEmail: "speaker@example.test" },
      ]);
      await expect(
        materializeQueuedCapabilityLinks(env.DB, { INTERNAL_SIGNING_SECRET: signingSecret }, payload),
      ).resolves.toMatchObject({ manageUrl: expect.stringMatching(/^pkc1_/) });
    }
  });

  it("rotates delivered speaker capabilities and upload generations with a canonical email change", async () => {
    await seedSpeakerCapability();
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "speaker_manage",
      resourceId: "speaker-capability",
    });
    const before = await env.DB.prepare("SELECT invite_generation FROM proposal_speakers WHERE id = ?")
      .bind("speaker-capability")
      .first<{ invite_generation: number }>();

    await env.DB.batch([prepareRotateUserProposalSpeakerManageSecrets(env.DB, "user-speaker")]);

    await expect(
      verifyDatabaseCapability({ db: env.DB, signingSecret, purpose: "speaker_manage", token }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    const after = await env.DB.prepare("SELECT invite_generation FROM proposal_speakers WHERE id = ?")
      .bind("speaker-capability")
      .first<{ invite_generation: number }>();
    expect(after?.invite_generation).toBe((before?.invite_generation ?? 0) + 1);
  });

  it("initializes a legacy speaker secret with Web Crypto when first issuing a link", async () => {
    await seedSpeakerCapability();
    await run(env.DB, "UPDATE proposal_speakers SET id = ?, manage_link_secret = NULL WHERE id = ?", [
      "speaker-legacy",
      "speaker-capability",
    ]);

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
