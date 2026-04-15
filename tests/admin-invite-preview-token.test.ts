import { describe, expect, it } from "vitest";
import {
  computeAttendeeInviteDigest,
  signAttendeeInvitePreviewToken,
  verifyAttendeeInvitePreviewToken,
} from "../functions/_lib/services/admin-invite-preview";

describe("admin attendee invite preview token", () => {
  it("verifies a valid preview token", async () => {
    const secret = "test-secret";
    const invites = [{ email: "alex@example.com", firstName: "Alex", lastName: "Morgan" }];
    const digest = await computeAttendeeInviteDigest(invites);

    const signed = await signAttendeeInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyAttendeeInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: digest,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a token when invite payload changed", async () => {
    const secret = "test-secret";
    const digest = await computeAttendeeInviteDigest([{ email: "alex@example.com" }]);
    const changedDigest = await computeAttendeeInviteDigest([{ email: "sam@example.com" }]);

    const signed = await signAttendeeInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: digest,
      ttlSeconds: 60,
    });

    const result = await verifyAttendeeInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: changedDigest,
    });

    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects an expired token", async () => {
    const secret = "test-secret";
    const digest = await computeAttendeeInviteDigest([{ email: "alex@example.com" }]);

    const signed = await signAttendeeInvitePreviewToken({
      secret,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: digest,
      ttlSeconds: -1,
    });

    const result = await verifyAttendeeInvitePreviewToken({
      secret,
      token: signed.token,
      eventId: "event-1",
      adminId: "admin-1",
      inviteDigest: digest,
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});
