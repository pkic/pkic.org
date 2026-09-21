import {
  MEMBERSHIP_APPLICATION_FORM_KEY,
  MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS,
  isMembershipApplicationFormKey,
  isMembershipApplicationPolicyFieldKey,
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationPolicyFieldsSchema,
  type MembershipApplicationFormDefinitionResponse,
  type MembershipApplicationFormDefinitionUpdate,
  type MembershipApplicationPolicyField,
} from "../../../../assets/shared/schemas/membership-application-form";
import type { FormDefinitionUpdateInput, FormFieldDefinition } from "../../../../assets/shared/schemas/forms";
import {
  memberApplicationFormResponseSchema,
  type MemberApplicationFormResponse,
} from "../../../../assets/shared/schemas/member-applications";
import { membershipWorkflowDefinitionSchema } from "../../../../assets/shared/schemas/membership-workflows";
import { all } from "../../db/queries";
import { listMembershipCategories } from "./categories";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { formChangedError, isFormMutationConflict } from "../forms/mutation-guard";
import { getGlobalFormByKey, getManagedFormWithFields, mapManagedFormFields } from "../forms/read";
import { updateManagedForm } from "../forms/management";

export function rejectLegacyMembershipApplicationFormRoute(formKey: string): void {
  if (!isMembershipApplicationFormKey(formKey)) return;
  throw new AppError(
    409,
    "MEMBERSHIP_APPLICATION_FORM_DEFINITION_REQUIRED",
    "Manage the membership application form through /api/v1/members/applications/form/definition.",
  );
}

async function requireMembershipApplicationForm(db: DatabaseLike) {
  const aggregate = await getManagedFormWithFields(db, MEMBERSHIP_APPLICATION_FORM_KEY);
  if (
    !aggregate ||
    aggregate.form.scope_type !== "global" ||
    aggregate.form.scope_ref !== null ||
    aggregate.form.purpose !== "application"
  ) {
    throw new AppError(
      500,
      "MEMBERSHIP_APPLICATION_FORM_MISSING",
      "The membership application form is missing or has an invalid configuration",
    );
  }
  return aggregate;
}

type FieldInput = NonNullable<FormDefinitionUpdateInput["fields"]>[number];

interface MembershipApplicationFields {
  fields: FormFieldDefinition[];
  policyFields: MembershipApplicationPolicyField[];
}

function invalidPolicyConfiguration(message: string): AppError {
  return new AppError(500, "MEMBERSHIP_APPLICATION_POLICY_FIELDS_INVALID", message);
}

export function requireMembershipApplicationPolicyFields(
  activeFields: FormFieldDefinition[],
): MembershipApplicationPolicyField[] {
  const parsed = membershipApplicationPolicyFieldsSchema.safeParse(
    MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS.flatMap((key) =>
      activeFields.filter((candidate) => candidate.key === key),
    ),
  );
  if (!parsed.success) {
    throw invalidPolicyConfiguration(
      "Every membership policy field must be present as a required boolean field that requires acceptance",
    );
  }
  return parsed.data;
}

function splitMembershipApplicationFields(
  aggregate: Awaited<ReturnType<typeof requireMembershipApplicationForm>>,
): MembershipApplicationFields {
  const activeFields = mapManagedFormFields(aggregate.fields.filter((field) => field.archived_at === null));
  return {
    fields: activeFields.filter((field) => !isMembershipApplicationPolicyFieldKey(field.key)),
    policyFields: requireMembershipApplicationPolicyFields(activeFields),
  };
}

function toFieldInput(field: FormFieldDefinition): FieldInput {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    sortOrder: field.sortOrder,
    ...(field.options === null ? {} : { options: field.options }),
    ...(field.optionSource === null ? {} : { optionSource: field.optionSource }),
    ...(field.validation === null ? {} : { validation: field.validation }),
  };
}

function protectedFieldsForReconciliation(
  aggregate: Awaited<ReturnType<typeof requireMembershipApplicationForm>>,
  requestedFields: FieldInput[],
  policyFields: MembershipApplicationPolicyField[],
): FieldInput[] {
  const archivedFields = aggregate.fields.filter((field) => field.archived_at !== null);
  const archivedIds = new Set(archivedFields.map((field) => field.id));
  const archivedKeys = new Set(archivedFields.map((field) => field.key));
  const policyIds = new Set(policyFields.map((field) => field.id));

  for (const field of requestedFields) {
    if (isMembershipApplicationPolicyFieldKey(field.key) || (field.id && policyIds.has(field.id))) {
      throw new AppError(
        422,
        "MEMBERSHIP_APPLICATION_POLICY_FIELD_PROTECTED",
        "Membership policy fields are controlled by the application workflow",
      );
    }
    if ((field.id && archivedIds.has(field.id)) || archivedKeys.has(field.key)) {
      throw new AppError(
        409,
        "MEMBERSHIP_APPLICATION_FORM_FIELD_ARCHIVED",
        `Archived field '${field.key}' cannot be restored through the membership application editor`,
      );
    }
  }

  return [...requestedFields, ...policyFields.map(toFieldInput)];
}

function toDefinitionResponse(
  aggregate: Awaited<ReturnType<typeof requireMembershipApplicationForm>>,
): MembershipApplicationFormDefinitionResponse {
  const { fields, policyFields } = splitMembershipApplicationFields(aggregate);
  return membershipApplicationFormDefinitionResponseSchema.parse({
    form: {
      id: aggregate.form.id,
      key: MEMBERSHIP_APPLICATION_FORM_KEY,
      title: aggregate.form.title,
      description: aggregate.form.description,
      purpose: aggregate.form.purpose,
      status: aggregate.form.status,
      updatedAt: aggregate.form.updated_at,
    },
    fields,
    policyFields,
  });
}
interface WorkflowDefinitionRow {
  id: string;
  definition_json: string;
}

async function applicationFeesByWorkflow(
  db: DatabaseLike,
  workflowVersionIds: readonly string[],
): Promise<Map<string, MemberApplicationFormResponse["categories"][number]["fee"]>> {
  const ids = [...new Set(workflowVersionIds)];
  if (ids.length === 0) return new Map();

  const rows = await all<WorkflowDefinitionRow>(
    db,
    `SELECT id, definition_json
       FROM membership_workflow_versions
      WHERE id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(ids)],
  );
  return new Map(
    rows.map((row) => {
      const definition = membershipWorkflowDefinitionSchema.parse(JSON.parse(row.definition_json));
      const payment = definition.steps.find((step) => step.kind === "payment");
      return [
        row.id,
        payment
          ? {
              label: payment.label,
              instructions: payment.instructions,
              amount: payment.amount,
              currency: payment.currency,
              deadlineDays: payment.deadlineDays,
            }
          : null,
      ];
    }),
  );
}

/** Public application form with the exact fee pinned to each category's published workflow. */
export async function getPublicMembershipApplicationForm(db: DatabaseLike): Promise<MemberApplicationFormResponse> {
  const [form, categories] = await Promise.all([
    getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY),
    listMembershipCategories(db, true),
  ]);
  if (form) requireMembershipApplicationPolicyFields(form.fields);

  const fees = await applicationFeesByWorkflow(
    db,
    categories.flatMap((category) => (category.workflowVersionId ? [category.workflowVersionId] : [])),
  );
  return memberApplicationFormResponseSchema.parse({
    form,
    categories: categories.map((category) => ({
      ...category,
      fee: category.workflowVersionId ? (fees.get(category.workflowVersionId) ?? null) : null,
    })),
  });
}

export async function getMembershipApplicationFormDefinition(
  db: DatabaseLike,
): Promise<MembershipApplicationFormDefinitionResponse> {
  return toDefinitionResponse(await requireMembershipApplicationForm(db));
}

export async function updateMembershipApplicationFormDefinition(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: MembershipApplicationFormDefinitionUpdate,
): Promise<MembershipApplicationFormDefinitionResponse> {
  const { expectedUpdatedAt, ...updates } = input;
  const current = await requireMembershipApplicationForm(db);
  if (current.form.updated_at !== expectedUpdatedAt) throw formChangedError();
  const { policyFields } = splitMembershipApplicationFields(current);
  const protectedUpdates: FormDefinitionUpdateInput = {
    ...updates,
    ...(updates.fields ? { fields: protectedFieldsForReconciliation(current, updates.fields, policyFields) } : {}),
  };

  try {
    await updateManagedForm(db, actor.id, current.form, protectedUpdates, {
      authorizationGuards: [preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }])],
      auditAction: "membership_application_form_updated",
      synchronizeInstallationPlacementStatus: true,
    });
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_APPLICATION_FORM_AUTHORIZATION_CHANGED",
        "Membership write permission changed while the form was being saved",
      );
    }
    if (isFormMutationConflict(error)) throw formChangedError();
    throw error;
  }

  return getMembershipApplicationFormDefinition(db);
}
