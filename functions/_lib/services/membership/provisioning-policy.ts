import { memberProvisionCategoryPolicySchema } from "../../../../assets/shared/schemas/membership-management";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { requireMembershipCategory } from "./categories";

/** Resolve holder type and validate the shared policy before preparing any membership writes. */
export async function requireProvisioningCategory(db: DatabaseLike, categoryCode: string, details: unknown) {
  const category = await requireMembershipCategory(db, categoryCode);
  const checked = memberProvisionCategoryPolicySchema(category).safeParse(details);
  if (!checked.success)
    throw new AppError(422, "VALIDATION_ERROR", "Check the category requirements", checked.error.flatten());
  return category;
}
