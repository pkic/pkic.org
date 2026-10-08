import { leadCaptureRequestSchema } from "../assets/shared/schemas/event-participation-reporting";
import { describe, expect, it } from "vitest";
import {
  BADGE_CREDENTIAL_ALPHABET,
  badgeCredentialSchema,
  formatBadgeCredential,
  generateBadgeCredential,
} from "../assets/shared/schemas/badge-credential";
import { databaseIdSchema } from "../assets/shared/schemas/identifiers";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { badgeIssueResponseSchema } from "../assets/shared/schemas/route-contracts-event-badges";

const canonical = "ABCDEFGHJKLMNPQR";
const id = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
describe("Manual badge credential codec", () => {
  it.each([canonical, "abcd-efgh-jklm-npqr", "ABCD EFGH JKLM NPQR", "  abcdefghjklmnpqr  "])(
    "normalizes the new code %s before shared scan transport",
    (value) => {
      expect(badgeCredentialSchema.parse(value)).toBe(canonical);
      expect(formatBadgeCredential(value)).toBe("ABCD-EFGH-JKLM-NPQR");
      expect(
        leadCaptureRequestSchema.parse({
          operatorUserId: id,
          operationId: id,
          deviceId: id,
          consentConfirmed: true,
          badgeId: value,
          observedAt: "2026-10-07T12:00:00.000Z",
        }).badgeId,
      ).toBe(canonical);
      expect(
        eventScanRequestSchema.parse({
          operatorUserId: id,
          operationId: id,
          deviceId: id,
          badgeId: value,
          occurrenceId: null,
          action: "check",
          observedAt: "2026-10-07T12:00:00.000Z",
        }).badgeId,
      ).toBe(canonical);
    },
  );
  it.each([
    "ABCD-EFGH JKLM-NPQR",
    "ABC-DEFGH-JKLM-NPQR",
    "ABCD--EFGH-JKLM-NPQR",
    "ABCD-EFGH-JKLM-NPQ",
    "ABCD-EFGH-JKLM-NPQRX",
    "ABCD-EFGH-IJKL-MNPQ",
    "ABCD-EFGH-0KLM-NPQR",
    "ABCD-EFGH-1KLM-NPQR",
    "\tabcdefghjklmnpqr",
    "abcdefghjklmnpqr\n",
    "https://example.test/ABCDEFGHJKLMNPQR",
    "code:ABCDEFGHJKLMNPQR",
    "ＡBCD-EFGH-JKLM-NPQR",
  ])("refuses malformed or ambiguous input %s", (value) => {
    expect(badgeCredentialSchema.safeParse(value).success).toBe(false);
  });
  it.each([id, id.toUpperCase(), "abcdefabcdefabcdefabcdefabcdefab", "ABCDEFABCDEFABCDEFABCDEFABCDEFAB"])(
    "refuses record identifiers and unsupported credential formats: %s",
    (value) => {
      expect(databaseIdSchema.parse(value)).toBe(value);
      expect(badgeCredentialSchema.safeParse(value).success).toBe(false);
      expect(
        leadCaptureRequestSchema.safeParse({
          operatorUserId: id,
          operationId: id,
          deviceId: id,
          consentConfirmed: true,
          badgeId: value,
          observedAt: "2026-10-07T12:00:00.000Z",
        }).success,
      ).toBe(false);
      expect(() => formatBadgeCredential(value)).toThrow();
      expect(badgeCredentialSchema.safeParse(" " + value + " ").success).toBe(false);
    },
  );
  it("issues a 16-character credential while row identifiers retain their separate schema", () => {
    const credential = generateBadgeCredential();
    expect(credential).toHaveLength(16);
    expect([...credential].every((symbol) => BADGE_CREDENTIAL_ALPHABET.includes(symbol))).toBe(true);
    expect(badgeCredentialSchema.parse(credential)).toBe(credential);
    expect(databaseIdSchema.safeParse(credential).success).toBe(false);
    expect(
      badgeIssueResponseSchema.parse({
        result: "issued",
        id,
        credential,
        expiresAt: "2026-12-01T00:00:00.000Z",
        replacedBadgeId: null,
      }).credential,
    ).toBe(credential);
  });
});
