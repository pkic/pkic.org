import { parseManifest } from "../../../scripts/membership-application-import/manifest.mjs";
import {
  memberApplicationCreateSchema,
  applicationStageSchema,
  APPLICATION_TERMINAL_STAGES,
} from "../../../assets/shared/schemas/member-applications";
import { utcInstantSchema, normalizedEmailSchema } from "../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../assets/shared/schemas/identifiers";
export const contracts = {
  memberApplicationCreateSchema,
  applicationStageSchema,
  APPLICATION_TERMINAL_STAGES,
  utcInstantSchema,
  normalizedEmailSchema,
  databaseIdSchema,
};
import { reviewedManifest, databaseId } from "../../helpers/application-backfill";
export { reviewedManifest, databaseId, actorId } from "../../helpers/application-backfill";

export function parsedReviewedManifest(localDirectory: string | null = null) {
  const parsed = parseManifest(reviewedManifest(localDirectory), contracts, databaseId);
  return {
    ...parsed,
    entries: parsed.entries.map((entry) => {
      if (entry.decision !== "import") throw new Error("Expected reviewed fixture");
      return entry;
    }),
  };
}
