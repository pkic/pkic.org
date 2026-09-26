import { describe, expect, it } from "vitest";
import {
  computeEventInviteDigest,
  signEventInvitePreviewToken,
  verifyEventInvitePreviewToken,
} from "../functions/_lib/services/event-invite-preview";

const INVITE_EXPIRES_AT = "2026-12-01T08:00:00.000Z";

describe("event invite preview token", () => {
  it("verifies a valid preview token", async () => {
    const secret = "test-secret";
    const invites = [{ email: "alex@example.com", firstName: "Alex", lastName: "Morgan" }];
    const digest = await computeEventInviteDigest(invites, INVITE_EXPIRES_AT);

    const signed = await signEventInvitePreviewToken({
      secret,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyEventInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a token when invite payload changed", async () => {
    const secret = "test-secret";
    const digest = await computeEventInviteDigest([{ email: "alex@example.com" }], INVITE_EXPIRES_AT);
    const changedDigest = await computeEventInviteDigest([{ email: "sam@example.com" }], INVITE_EXPIRES_AT);

    const signed = await signEventInvitePreviewToken({
      secret,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyEventInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: changedDigest,
    });

    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects an expired token", async () => {
    const secret = "test-secret";
    const digest = await computeEventInviteDigest([{ email: "alex@example.com" }], INVITE_EXPIRES_AT);

    const signed = await signEventInvitePreviewToken({
      secret,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: -1,
    });

    const result = await verifyEventInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("does not allow an attendee preview token to authorize speaker invitations", async () => {
    const secret = "test-secret";
    const digest = await computeEventInviteDigest([{ email: "alex@example.com" }], INVITE_EXPIRES_AT);
    const signed = await signEventInvitePreviewToken({
      secret,
      eventId: "event-1",
      actorId: "actor-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    expect(
      await verifyEventInvitePreviewToken({
        secret,
        token: signed.token,
        eventId: "event-1",
        actorId: "actor-1",
        inviteType: "speaker",
        inviteDigest: digest,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("binds the invitation deadline into the reviewed payload", async () => {
    const invites = [{ email: "alex@example.com" }];
    const first = await computeEventInviteDigest(invites, INVITE_EXPIRES_AT);
    const changed = await computeEventInviteDigest(invites, "2026-12-02T08:00:00.000Z");

    expect(changed).not.toBe(first);
  });
});
