import { it, expect } from "vitest";
import {
  sitePublicationActivationSchema,
  sitePublicationBuildCompletionSchema,
  sitePublicationRequestQuerySchema,
  sitePublicationRequestInputSchema,
} from "../../assets/shared/schemas/site-publication-requests";
it("requires an activation receipt separately from a successful build and bounds operational lists", () => {
  const build = {
    requestId: crypto.randomUUID(),
    leaseToken: crypto.randomUUID(),
    sourceSequence: 7,
    snapshotId: "a".repeat(64),
    buildId: "build-7",
    releaseId: "release-7",
  };
  expect(sitePublicationBuildCompletionSchema.safeParse(build).success).toBe(true);
  expect(sitePublicationActivationSchema.safeParse(build).success).toBe(false);
  expect(
    sitePublicationActivationSchema.safeParse({
      ...build,
      expectedDeliveredSequence: 6,
      activationReceiptId: "deployment-7",
      activatedAt: "2026-10-04T00:00:00.000Z",
    }).success,
  ).toBe(true);
  expect(sitePublicationRequestQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  expect(
    sitePublicationRequestInputSchema.safeParse({
      resourceType: "event_agenda",
      resourceId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      reasonCode: "agenda_approved",
      deduplicationKey: "agenda:event:1",
    }).success,
  ).toBe(true);
  expect(
    sitePublicationRequestInputSchema.safeParse({
      resourceType: "event_agenda",
      resourceId: "11111111-1111-4111-8111-111111111111",
      revision: -1,
      reasonCode: "agenda_approved",
      deduplicationKey: "agenda:event:1",
    }).success,
  ).toBe(false);
});
