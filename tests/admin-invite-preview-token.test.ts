import { describe, expect, it } from "vitest";
import {
  computeAdminInviteDigest,
  signAdminInvitePreviewToken,
  verifyAdminInvitePreviewToken,
} from "../functions/_lib/services/admin-invite-preview";

describe("admin invite preview token", () => {
  it("verifies a valid preview token", async () => {
    const secret = "test-secret";
    const invites = [{ email: "alex@example.com", firstName: "Alex", lastName: "Morgan" }];
    const digest = await computeAdminInviteDigest(invites);

    const signed = await signAdminInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyAdminInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a token when invite payload changed", async () => {
    const secret = "test-secret";
    const digest = await computeAdminInviteDigest([{ email: "alex@example.com" }]);
    const changedDigest = await computeAdminInviteDigest([{ email: "sam@example.com" }]);

    const signed = await signAdminInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyAdminInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: changedDigest,
    });

    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects an expired token", async () => {
    const secret = "test-secret";
    const digest = await computeAdminInviteDigest([{ email: "alex@example.com" }]);

    const signed = await signAdminInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: -1,
    });

    const result = await verifyAdminInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("does not allow an attendee preview token to authorize speaker invitations", async () => {
    const secret = "test-secret";
    const digest = await computeAdminInviteDigest([{ email: "alex@example.com" }]);
    const signed = await signAdminInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteType: "attendee",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    expect(
      await verifyAdminInvitePreviewToken({
        secret,
        token: signed.token,
        eventId: "event-1",
        adminId: "admin-1",
        inviteType: "speaker",
        inviteDigest: digest,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });
});
