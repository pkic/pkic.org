import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  effectiveInviteExpirySql,
  effectiveStoredInviteExpiry,
  resolveEventInviteExpiry,
} from "../functions/_lib/invite-validity";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createInvite } from "../functions/_lib/services/invite-creation";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const EVENT = {
  starts_at: "2027-03-10T09:00:00.000Z",
  ends_at: "2027-03-10T17:00:00.000Z",
};
const NOW = "2027-03-01T12:00:00.000Z";

describe("event invitation validity", () => {
  it("defaults to the event start and preserves an earlier explicit deadline", () => {
    expect(resolveEventInviteExpiry(EVENT, undefined, NOW)).toBe(EVENT.starts_at);
    expect(resolveEventInviteExpiry(EVENT, "2027-03-09T12:00:00.000Z", NOW)).toBe("2027-03-09T12:00:00.000Z");
  });

  it("allows the exact event end but rejects any later deadline", () => {
    expect(resolveEventInviteExpiry(EVENT, EVENT.ends_at, NOW)).toBe(EVENT.ends_at);
    expect(() => resolveEventInviteExpiry(EVENT, "2027-03-10T17:00:00.001Z", NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_AFTER_EVENT" }),
    );
  });

  it("rejects past, malformed, missing, and inverted windows", () => {
    expect(() => resolveEventInviteExpiry(EVENT, NOW, NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_PAST" }),
    );
    expect(() => resolveEventInviteExpiry(EVENT, "not-a-date", NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_INVALID" }),
    );
    expect(() => resolveEventInviteExpiry({ starts_at: null, ends_at: EVENT.ends_at }, undefined, NOW)).toThrow(
      expect.objectContaining({ code: "EVENT_INVITE_WINDOW_REQUIRED" }),
    );
    expect(() =>
      resolveEventInviteExpiry({ starts_at: EVENT.ends_at, ends_at: EVENT.starts_at }, undefined, NOW),
    ).toThrow(expect.objectContaining({ code: "EVENT_INVITE_WINDOW_REQUIRED" }));
  });

  it("applies the same default and maximum to stored legacy values", () => {
    expect(effectiveStoredInviteExpiry(EVENT, null)).toBe(EVENT.starts_at);
    expect(effectiveStoredInviteExpiry(EVENT, "2027-03-09T12:00:00.000Z")).toBe("2027-03-09T12:00:00.000Z");
    expect(effectiveStoredInviteExpiry(EVENT, "2027-03-11T12:00:00.000Z")).toBe(EVENT.ends_at);
    expect(effectiveStoredInviteExpiry({ starts_at: EVENT.starts_at, ends_at: null }, EVENT.starts_at)).toBeNull();
  });
});

describe("stored event invitation validity in D1", () => {
  beforeEach(resetDb);

  it("projects NULL to event start, caps overlong rows at event end, and preserves an earlier deadline", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const values = [
      { id: crypto.randomUUID(), email: "default-expiry@example.test", expiresAt: null },
      { id: crypto.randomUUID(), email: "early-expiry@example.test", expiresAt: "2026-11-01T08:00:00.000Z" },
      { id: crypto.randomUUID(), email: "overlong-expiry@example.test", expiresAt: "2027-01-01T08:00:00.000Z" },
    ];
    await env.DB.batch(
      values.map((value) =>
        env.DB.prepare(
          `INSERT INTO invites
               (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
             VALUES (?, ?, ?, 'attendee', ?, 'sent', 'test', ?, '2026-08-27T00:00:00.000Z')`,
        ).bind(value.id, eventId, value.email, crypto.randomUUID(), value.expiresAt),
      ),
    );

    const rows = await queryAll<{ invitee_email: string; effective_expiry: string }>(
      env.DB,
      `SELECT i.invitee_email, ${effectiveInviteExpirySql("i", "e")} AS effective_expiry
       FROM invites i JOIN events e ON e.id = i.event_id
       WHERE i.id IN (SELECT value FROM json_each(?))
       ORDER BY i.invitee_email`,
      [JSON.stringify(values.map((value) => value.id))],
    );

    expect(rows).toEqual([
      { invitee_email: "default-expiry@example.test", effective_expiry: "2026-12-01T08:00:00.000Z" },
      { invitee_email: "early-expiry@example.test", effective_expiry: "2026-11-01T08:00:00.000Z" },
      { invitee_email: "overlong-expiry@example.test", effective_expiry: "2026-12-03T18:00:00.000Z" },
    ]);
  });

  it("does not insert an invitation after a concurrent event schedule change", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET ends_at = starts_at WHERE id = ?").bind(eventId).run();
    });

    await expect(
      createInvite(racingDb, {
        eventId,
        inviteeEmail: "direct-schedule-race@example.test",
        inviteType: "attendee",
      }),
    ).rejects.toMatchObject({ code: "EVENT_INVITE_WINDOW_CHANGED", status: 409 });
    await expect(
      queryAll(env.DB, "SELECT id FROM invites WHERE invitee_email = 'direct-schedule-race@example.test'"),
    ).resolves.toHaveLength(0);
  });
});
