import {
  membershipApplicationImportRequestSchema,
  membershipApplicationImportResponseSchema,
} from "../../../assets/shared/schemas/membership-application-import";
import { utcInstantSchema } from "../../../assets/shared/schemas/api-common";

export const contracts = {
  membershipApplicationImportRequestSchema,
  membershipApplicationImportResponseSchema,
  utcInstantSchema,
};
export const resultId = "11111111-1111-4111-8111-111111111111";
export function reviewedManifest(origin = "https://pkic.org") {
  return {
    version: 1,
    runId: "22222222-2222-4222-8222-222222222222",
    portalOrigin: origin,
    environment: origin.startsWith("http:") ? "local" : "production",
    sourceData: "synthetic",
    entries: [1, 2].map((sourceIssueNumber) => ({
      decision: "import",
      sourceIssueNumber,
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "Example reviewer",
      reviewedAt: "2026-01-02T00:00:00.000Z",
      mapping: {
        manualHold: false,
        answers: {},
        applicantName: "Example User",
        applicantEmail: "user@example.org",
        organizationName: "Example Organization",
        categoryCode: null,
        applicantUserId: null,
        organizationId: null,
        outcome: "closed_unknown",
        mappingReason: "Reviewed historical application form and source evidence",
        workflow: null,
      },
    })),
  };
}
