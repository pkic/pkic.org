import {
  groupFormSubmissionStatsResponseSchema,
  groupFormSubmissionsResponseSchema,
  type GroupFormSubmissionStatsQuery,
  type GroupFormSubmissionsQuery,
} from "../../../../assets/shared/schemas/group-forms";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getFormSubmissionStats, listFormSubmissions } from "../form-submissions";
import { guardManagedGroupResourceDatabase, requireGroupResourceAccess } from "../resource-grants";
import { getFormDefinitionByPlacement } from "./read";
import { AppError } from "../../errors";

async function requireReportableForm(db: DatabaseLike, actor: AuthAdmin, groupId: string, placementId: string) {
  await requireGroupResourceAccess(db, actor, "formPlacement", placementId, "view_responses", groupId);
  const reportingDb = guardManagedGroupResourceDatabase(
    db,
    actor,
    groupId,
    "formPlacement",
    placementId,
    "view_responses",
  );
  const form = await getFormDefinitionByPlacement(reportingDb, placementId);
  if (!form?.placement) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  return { form, reportingDb };
}

function formReference(form: NonNullable<Awaited<ReturnType<typeof getFormDefinitionByPlacement>>>) {
  return {
    id: form.id,
    key: form.key,
    purpose: form.purpose,
    status: form.status,
    title: form.title,
    description: form.description,
    updatedAt: form.formUpdatedAt,
  };
}

export async function listGroupFormResponses(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  placementId: string,
  query: GroupFormSubmissionsQuery,
) {
  const { form, reportingDb } = await requireReportableForm(db, actor, groupId, placementId);
  const result = await listFormSubmissions(reportingDb, { formKey: form.key, placementId, ...query });
  return groupFormSubmissionsResponseSchema.parse({
    form: formReference(form),
    placement: form.placement,
    submissions: result.submissions,
    page: buildPageInfo(result.limit, result.offset, result.total, result.submissions.length),
  });
}

export async function getGroupFormResponseStatistics(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  placementId: string,
  query: GroupFormSubmissionStatsQuery,
) {
  const { form, reportingDb } = await requireReportableForm(db, actor, groupId, placementId);
  const result = await getFormSubmissionStats(reportingDb, { formKey: form.key, placementId, ...query });
  return groupFormSubmissionStatsResponseSchema.parse({
    form: formReference(form),
    placement: form.placement,
    total: result.total,
    stats: result.stats,
  });
}
