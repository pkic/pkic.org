import type { Locator, Page } from "@playwright/test";
import { INDEPENDENT_CAPACITY_COPY as copy } from "../../../assets/shared/email-first-copy";
import {
  INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  type IndependentCapacityDisclosure,
} from "../../../assets/shared/schemas/independent-capacity";

/** The disclosure an API fixture sends when it takes part as an individual. */
export const INDEPENDENT_CAPACITY_FIXTURE: IndependentCapacityDisclosure = {
  version: INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  organizationConnection: "no",
  noRelatedEngagement: true,
  formerAffiliations: "None",
  currentPosition: "Independent consultant",
  acceptsAccountability: true,
  acknowledgesPolicies: true,
};

/** Answers the visible independence disclosure as a speaker taking part as an individual. */
export async function completeIndependentCapacityDisclosure(scope: Page | Locator): Promise<void> {
  const disclosure = scope.getByRole("group", { name: copy.question });
  await disclosure.getByRole("radio", { name: copy.no, exact: true }).check();
  await scope.getByRole("textbox", { name: copy.formerAffiliationsLabel, exact: true }).fill("None");
  await scope.getByRole("textbox", { name: copy.currentPositionLabel, exact: true }).fill("Independent consultant");
  await scope.getByRole("checkbox", { name: copy.noRelatedEngagement, exact: true }).check();
  await scope.getByRole("checkbox", { name: copy.accountability, exact: true }).check();
  await scope.getByRole("checkbox", { name: new RegExp(`^${copy.policyBefore}`) }).check();
}
