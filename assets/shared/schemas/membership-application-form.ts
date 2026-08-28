import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { formDefinitionUpdateSchema, formFieldDefinitionSchema, formStatusSchema } from "./forms";

/** Stable key for the singleton, globally placed membership application form. */
export const MEMBERSHIP_APPLICATION_FORM_KEY = "membership-application";

/** Workflow-owned policy acknowledgements that form editors may display but never mutate. */
export const MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS = [
  "agrees_bylaws",
  "agrees_code_of_conduct",
  "agrees_ipr_policy",
  "warranted_authority",
] as const;
export const membershipApplicationPolicyFieldKeySchema = z.enum(MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS);
export type MembershipApplicationPolicyFieldKey = z.infer<typeof membershipApplicationPolicyFieldKeySchema>;

const membershipApplicationPolicyFieldKeys = new Set<string>(MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS);

export function isMembershipApplicationPolicyFieldKey(key: string): key is MembershipApplicationPolicyFieldKey {
  return membershipApplicationPolicyFieldKeys.has(key);
}

export const membershipApplicationPolicyFieldSchema = formFieldDefinitionSchema.extend({
  key: membershipApplicationPolicyFieldKeySchema,
  fieldType: z.literal("boolean"),
  required: z.literal(true),
  validation: formFieldDefinitionSchema.shape.validation.unwrap().safeExtend({ requireTrue: z.literal(true) }),
  archivedAt: z.null(),
});
export const membershipApplicationPolicyFieldsSchema = z
  .array(membershipApplicationPolicyFieldSchema)
  .length(MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS.length)
  .superRefine((fields, context) => {
    const keys = new Set(fields.map((field) => field.key));
    MEMBERSHIP_APPLICATION_POLICY_FIELD_KEYS.forEach((key) => {
      if (keys.has(key)) return;
      context.addIssue({ code: "custom", message: `Membership policy field '${key}' is missing` });
    });
  });
export type MembershipApplicationPolicyField = z.infer<typeof membershipApplicationPolicyFieldSchema>;

export function isMembershipApplicationFormKey(key: string): boolean {
  return key === MEMBERSHIP_APPLICATION_FORM_KEY;
}

/** Staff-facing definition with editable questions separated from workflow-owned policy acknowledgements. */
export const membershipApplicationFormDefinitionResponseSchema = z.object({
  form: z.object({
    id: databaseIdSchema,
    key: z.literal(MEMBERSHIP_APPLICATION_FORM_KEY),
    title: z.string(),
    description: z.string().nullable(),
    purpose: z.literal("application"),
    status: formStatusSchema,
    updatedAt: z.string(),
  }),
  fields: z.array(formFieldDefinitionSchema),
  policyFields: membershipApplicationPolicyFieldsSchema,
});
export type MembershipApplicationFormDefinitionResponse = z.infer<
  typeof membershipApplicationFormDefinitionResponseSchema
>;

/** Uses the form definition's updated timestamp as its compare-and-set revision. */
export const membershipApplicationFormDefinitionUpdateSchema = formDefinitionUpdateSchema
  .extend({ expectedUpdatedAt: z.string().min(1) })
  .superRefine(({ expectedUpdatedAt: _expectedUpdatedAt, fields, ...changes }, context) => {
    if (fields) {
      fields.forEach((field, index) => {
        if (!isMembershipApplicationPolicyFieldKey(field.key)) return;
        context.addIssue({
          code: "custom",
          path: ["fields", index, "key"],
          message: "Membership policy fields are controlled by the application workflow",
        });
      });
    }
    if (fields === undefined && Object.keys(changes).length === 0) {
      context.addIssue({ code: "custom", message: "At least one form setting must be updated" });
    }
  });
export type MembershipApplicationFormDefinitionUpdate = z.infer<typeof membershipApplicationFormDefinitionUpdateSchema>;

export const membershipApplicationFormDefinitionGetRouteSchema = {
  tags: ["Membership"],
  summary: "Get membership application form definition",
  description:
    "Returns editable dynamic questions separately from read-only workflow policy fields. Archived fields remain available only in historical responses.",
  responses: {
    "200": {
      description: "Editable membership application form definition.",
      content: {
        "application/json": { schema: membershipApplicationFormDefinitionResponseSchema },
      },
    },
    "401": { description: "A staff session is required." },
    "403": { description: "Membership read permission is required." },
  },
};

export const membershipApplicationFormDefinitionUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update membership application form definition",
  description:
    "Atomically updates the form definition and dynamic questions under a live membership permission guard. Workflow policy fields cannot be changed or restored through this endpoint.",
  request: {
    body: {
      content: { "application/json": { schema: membershipApplicationFormDefinitionUpdateSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated membership application form.",
      content: {
        "application/json": { schema: membershipApplicationFormDefinitionResponseSchema },
      },
    },
    "401": { description: "A staff session is required." },
    "403": { description: "Membership write permission is required." },
    "409": { description: "The form or authorization changed before the update was committed." },
  },
};
