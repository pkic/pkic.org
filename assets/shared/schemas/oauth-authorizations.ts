import { z } from "zod";
import { accessGrantCreateSchema, validateAuthorizationContext } from "./access-control";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { PERMISSION_DOMAINS } from "../permission-metadata";
import {
  OAUTH_CLIENT_NAME_MAX_LENGTH,
  OAUTH_AUTHORIZATION_MAX_CONTEXTS,
  OAUTH_AUTHORIZATION_STATUSES,
} from "../oauth-authorization-policy";
import { searchableListQuerySchema, sortColumnSchemaWithDefault, paginatedResponseSchema } from "./pagination";
import { addDuplicateStringIssues } from "./refinements";
import { PERMISSIONS, permissionSchema } from "./permissions";
import { requiresSession, ok, authErrors } from "./route-contract";

export const oauthAuthorizationScopeSchema = z
  .object({
    permission: accessGrantCreateSchema.shape.permission,
    contextType: accessGrantCreateSchema.shape.contextType.unwrap(),
    contextId: accessGrantCreateSchema.shape.contextId.unwrap(),
  })
  .superRefine(validateAuthorizationContext);
export type OauthAuthorizationScope = z.infer<typeof oauthAuthorizationScopeSchema>;
export const oauthAuthorizationScopesSchema = z
  .array(oauthAuthorizationScopeSchema)
  .max(OAUTH_AUTHORIZATION_MAX_CONTEXTS)
  .superRefine((scopes, ctx) =>
    addDuplicateStringIssues(scopes, ctx, {
      value: (scope) => JSON.stringify([scope.permission, scope.contextType, scope.contextId]),
      path: (index) => [index],
      label: "Permission limit",
    }),
  );
export const oauthAuthorizationStatusSchema = z.enum(OAUTH_AUTHORIZATION_STATUSES);
export const oauthClientIdentitySchema = z.object({
  clientId: z.string().min(1).max(2048),
  // The recorded name is what the user saw when approving, not a live client profile.
  clientName: z.string().min(1).max(OAUTH_CLIENT_NAME_MAX_LENGTH),
});
export const oauthAuthorizationSchema = oauthClientIdentitySchema.extend({
  id: databaseIdSchema,
  status: oauthAuthorizationStatusSchema,
  createdAt: utcInstantSchema,
  expiresAt: utcInstantSchema,
  revision: utcInstantSchema,
  scopeCount: z.number().int().min(0).max(OAUTH_AUTHORIZATION_MAX_CONTEXTS),
});
export type OauthAuthorization = z.infer<typeof oauthAuthorizationSchema>;
export const oauthAuthorizationParamsSchema = z.object({ id: databaseIdSchema });
export const oauthAuthorizationsQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(["clientName", "createdAt", "expiresAt"] as const, "-createdAt"),
).extend({ status: oauthAuthorizationStatusSchema.optional() });
export type OauthAuthorizationsQuery = z.infer<typeof oauthAuthorizationsQuerySchema>;
export const oauthAuthorizationsResponseSchema = paginatedResponseSchema("authorizations", oauthAuthorizationSchema);
export const oauthAuthorizationResponseSchema = z.object({ authorization: oauthAuthorizationSchema });
export const oauthAuthorizationScopeResourceSchema = oauthAuthorizationScopeSchema.safeExtend({
  label: z.string(),
  domain: z.enum(Object.keys(PERMISSION_DOMAINS) as (keyof typeof PERMISSION_DOMAINS)[]),
  access: z.enum(["read", "write"]),
  contextName: z.string().nullable(),
});
export const oauthAuthorizationScopesQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(["permission", "contextName"] as const, "permission"),
).extend({
  domain: oauthAuthorizationScopeResourceSchema.shape.domain.optional(),
  access: oauthAuthorizationScopeResourceSchema.shape.access.optional(),
});
export type OauthAuthorizationScopesQuery = z.infer<typeof oauthAuthorizationScopesQuerySchema>;
export const oauthAuthorizationScopesResponseSchema = paginatedResponseSchema(
  "scopes",
  oauthAuthorizationScopeResourceSchema,
);
export const oauthAuthorizationReductionSchema = z.object({
  revision: utcInstantSchema,
  remove: oauthAuthorizationScopesSchema.min(1),
});
export type OauthAuthorizationReduction = z.infer<typeof oauthAuthorizationReductionSchema>;
export const oauthAuthorizationRevocationSchema = z.object({ revision: utcInstantSchema });
export const oauthAuthorizationApprovalResponseSchema = z.object({
  authorizationId: databaseIdSchema,
  status: z.literal("pending"),
});
export const oauthAuthorizationCompletionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("active"), redirectTo: z.string().min(1).max(8192) }),
  z.object({ status: z.enum(["failed", "revoked", "expired"]) }),
]);
const common = { tags: ["Authentication"], ...requiresSession() };
export const oauthAuthorizationsListRouteSchema = {
  ...common,
  summary: "List the current user's OAuth client authorizations",
  request: { query: oauthAuthorizationsQuerySchema },
  responses: { ...ok("Authorizations.", oauthAuthorizationsResponseSchema), ...authErrors() },
};
export const oauthAuthorizationGetRouteSchema = {
  ...common,
  summary: "Review an OAuth client authorization",
  request: { params: oauthAuthorizationParamsSchema },
  responses: {
    ...ok("Authorization.", oauthAuthorizationResponseSchema),
    ...authErrors({ notFound: "Authorization not found." }),
  },
};
export const oauthAuthorizationScopesListRouteSchema = {
  ...common,
  summary: "List an authorization's approved permission and resource limits",
  request: { params: oauthAuthorizationParamsSchema, query: oauthAuthorizationScopesQuerySchema },
  responses: {
    ...ok("Approved limits.", oauthAuthorizationScopesResponseSchema),
    ...authErrors({ notFound: "Authorization not found." }),
  },
};
export const oauthAuthorizationReduceRouteSchema = {
  ...common,
  summary: "Reduce an OAuth authorization without adding permissions",
  request: {
    params: oauthAuthorizationParamsSchema,
    body: { required: true, content: { "application/json": { schema: oauthAuthorizationReductionSchema } } },
  },
  responses: {
    ...ok("Reduced authorization.", oauthAuthorizationResponseSchema),
    ...authErrors({ notFound: "Authorization not found.", conflict: "The authorization changed." }),
  },
};
export const oauthAuthorizationRevokeRouteSchema = {
  ...common,
  summary: "Revoke an OAuth authorization",
  request: {
    params: oauthAuthorizationParamsSchema,
    body: { required: true, content: { "application/json": { schema: oauthAuthorizationRevocationSchema } } },
  },
  responses: {
    ...ok("Revoked authorization.", oauthAuthorizationResponseSchema),
    ...authErrors({ notFound: "Authorization not found.", conflict: "The authorization changed." }),
  },
};
export const oauthAuthorizationCompletionRouteSchema = {
  ...common,
  summary: "Read the result of an OAuth approval",
  request: { params: oauthAuthorizationParamsSchema },
  responses: {
    ...ok("Approval result.", oauthAuthorizationCompletionSchema),
    ...authErrors({ notFound: "Authorization not found." }),
  },
};

export const oauthSelectedScopesSchema = z
  .array(permissionSchema)
  .min(1, "Choose at least one permission")
  .max(PERMISSIONS.length)
  .superRefine((values, ctx) =>
    addDuplicateStringIssues(values, ctx, { value: (value) => value, path: (index) => [index], label: "Permission" }),
  );
