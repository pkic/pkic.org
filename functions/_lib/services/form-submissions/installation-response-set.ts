import type { FormSubmissionStatsQuery, FormSubmissionsQuery } from "../../../../assets/shared/schemas/form-management";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { getManagedFormWithFields } from "../forms/read";
import { rejectLegacyMembershipApplicationFormRoute } from "../membership/application-form";
import { findFormPlacement } from "../forms/placements";
import { getFormSubmissionStats } from "./field-statistics";
import { listFormSubmissions } from "./submission-page";

type InstallationSubmissionFilters = { formKey: string } & Pick<
  FormSubmissionStatsQuery,
  "status" | "attendanceType" | "q"
>;

export type ListInstallationFormSubmissionsParams = InstallationSubmissionFilters &
  Pick<FormSubmissionsQuery, "sort" | "limit" | "offset">;

/**
 * Resolves the one installation-owned response set for a global definition.
 * Event and group placements are intentionally invisible through `/forms`;
 * their owning resource routes authorize and expose those response sets.
 */
export async function requireInstallationFormResponseSet(db: DatabaseLike, formKey: string) {
  rejectLegacyMembershipApplicationFormRoute(formKey);
  const aggregate = await getManagedFormWithFields(db, formKey);
  if (!aggregate || aggregate.form.scope_type !== "global") {
    throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  }

  const placement = await findFormPlacement(db, aggregate.form.id, {
    contextType: "installation",
    contextRef: null,
  });
  if (!placement || placement.ownerGroupId !== null) {
    throw new AppError(404, "FORM_RESPONSE_SET_NOT_FOUND", "The global form response set was not found");
  }
  return { aggregate, placement };
}

export async function listInstallationFormSubmissions(db: DatabaseLike, params: ListInstallationFormSubmissionsParams) {
  const { placement } = await requireInstallationFormResponseSet(db, params.formKey);
  return listFormSubmissions(db, { ...params, placementId: placement.id });
}

export async function getInstallationFormSubmissionStats(db: DatabaseLike, params: InstallationSubmissionFilters) {
  const { placement } = await requireInstallationFormResponseSet(db, params.formKey);
  return getFormSubmissionStats(db, { ...params, placementId: placement.id });
}
