import { describe, expect, it } from "vitest";
import {
  computeCampaignDigest,
  signCampaignPreviewToken,
  verifyCampaignPreviewToken,
} from "../functions/_lib/services/admin-email-campaign";

describe("admin campaign preview token", () => {
  it("accepts a valid token for identical payload", async () => {
    const digest = await computeCampaignDigest({
      templateKey: "attendee_invite",
      subjectOverride: "Subject",
      customText: "Hello",
      sendMode: "personal",
      batchSize: 500,
      filter: { audience: "attendees", attendanceType: "all" },
      recipients: [{ email: "a@example.com", firstName: "A", lastName: "B", templateData: {} }],
    });

    const signed = await signCampaignPreviewToken({
      secret: "test-secret",
      eventId: "evt-1",
      adminId: "admin-1",
      digest,
      ttlSeconds: 60,
    });

    const result = await verifyCampaignPreviewToken({
      secret: "test-secret",
      token: signed.token,
      eventId: "evt-1",
      adminId: "admin-1",
      digest,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects stale token when payload digest differs", async () => {
    const digestA = await computeCampaignDigest({
      templateKey: "attendee_invite",
      subjectOverride: "Subject",
      customText: "Hello",
      sendMode: "personal",
      batchSize: 500,
      filter: { audience: "attendees", attendanceType: "all" },
      recipients: [{ email: "a@example.com", firstName: "A", lastName: "B", templateData: {} }],
    });

    const digestB = await computeCampaignDigest({
      templateKey: "attendee_invite",
      subjectOverride: "Subject changed",
      customText: "Hello",
      sendMode: "personal",
      batchSize: 500,
      filter: { audience: "attendees", attendanceType: "all" },
      recipients: [{ email: "a@example.com", firstName: "A", lastName: "B", templateData: {} }],
    });

    const signed = await signCampaignPreviewToken({
      secret: "test-secret",
      eventId: "evt-1",
      adminId: "admin-1",
      digest: digestA,
      ttlSeconds: 60,
    });

    const result = await verifyCampaignPreviewToken({
      secret: "test-secret",
      token: signed.token,
      eventId: "evt-1",
      adminId: "admin-1",
      digest: digestB,
    });

    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});
