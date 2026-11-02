import { z } from "zod";
import { successResponseSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  currentUserIdentityCreateSchema,
  currentUserIdentityUpdateSchema,
  identitiesListQuerySchema,
  identitiesListResponseSchema,
  identityCreateSchema,
  identityMutationResponseSchema,
  identityCorrectionSchema,
  identityInvitationLinkRequestSchema,
  identityInvitationPreviewResponseSchema,
  identityReinstatementLinkRequestSchema,
  identityReinstatementPreviewResponseSchema,
  identityReinstatementRequestResponseSchema,
  identityUpdateSchema,
} from "./identity";
import { authErrors, requiresPermissions, requiresSession } from "./route-contract";

export const organizationIdentityCollectionParamsSchema = z.object({ organizationId: databaseIdSchema });
export const organizationIdentityParamsSchema = organizationIdentityCollectionParamsSchema.extend({
  identityId: databaseIdSchema,
});

/**
 * Creating an identity as one value: the organization the route reads from
 * its path and the identity it reads from the body. A form that picks the
 * organization and describes the identity at once validates through both.
 */
export const organizationIdentityCreateRequestSchema = z.intersection(
  organizationIdentityCollectionParamsSchema,
  identityCreateSchema,
);

export const organizationIdentitiesListRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "List organization identities",
  description: "Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: {
    params: organizationIdentityCollectionParamsSchema,
    query: identitiesListQuerySchema,
  },
  responses: {
    "200": {
      description: "A bounded identity page.",
      content: { "application/json": { schema: identitiesListResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or authorized staff member is required."),
  },
};

export const organizationIdentityCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "Create an organization identity",
  description:
    "Organization contacts create a pending invitation. Immediate activation requires a user-backed staff session with both membership:write and identities:activate, a reason, and an attributable audit record.",
  request: {
    params: organizationIdentityCollectionParamsSchema,
    body: { required: true, content: { "application/json": { schema: identityCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Identity created.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or the required staff permission is required."),
    "404": jsonErrorResponse("Organization not found."),
    "409": jsonErrorResponse("An active, pending, or blocked identity conflicts with this request."),
    "422": jsonErrorResponse("The selected email does not prove the organization relationship."),
  },
};

export const organizationIdentityUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "Update an organization identity",
  description:
    "Updates either scoped profile data or one lifecycle transition. Moving an ended identity to `active` reinstates that same identity: its end date is removed, and the group seats and roles its end closed reopen where they can still be held. An authorized organization contact may reinstate; an identity that was blocked, was replaced by a successor, or whose person already has another active or pending identity for the organization cannot be reinstated. Activating a pending identity immediately, or starting a successor to a blocked identity, requires a user-backed staff session with both membership:write and identities:activate.",
  request: {
    params: organizationIdentityParamsSchema,
    body: { required: true, content: { "application/json": { schema: identityUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Identity updated.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or the required staff permission is required."),
    "409": jsonErrorResponse(
      "The identity or authorization changed concurrently, or the identity cannot be reinstated (IDENTITY_NOT_REINSTATABLE, IDENTITY_SUPERSEDED, IDENTITY_CONFLICT).",
    ),
  },
};

export const currentUserIdentitiesListRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "List the current user's acting identities",
  request: { query: identitiesListQuerySchema },
  responses: {
    "200": {
      description: "The current user's bounded identity page.",
      content: { "application/json": { schema: identitiesListResponseSchema } },
    },
  },
};

export const currentUserIdentityCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Activate a verified-domain identity for the current user",
  description:
    "Accepts an explicit claimed-domain organization offer or a prepared representation based on an owned verified work address. The canonical domain policy resolves existing organizations, unclaimed-domain creation, and review. Only explicit acceptance may activate canonical Member group enrollments.",
  request: {
    body: { required: true, content: { "application/json": { schema: currentUserIdentityCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Identity activated.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "409": jsonErrorResponse("An identity or domain claim conflicts with this request."),
    "422": jsonErrorResponse("The selected verified email does not prove this organization relationship."),
  },
};

export const currentUserIdentityUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Accept or end one of the current user's identities",
  description:
    "Accepts a pending identity invitation or ends an active identity, only when it is owned by the signed-in user. Accepting begins Member and automatic group access in the same guarded D1 batch; merely receiving or verifying the invitation email grants no access. Ending takes an optional end date that defaults to now and can be neither in the future nor before the identity started; group seats held through the identity end at the same instant.",
  request: {
    params: z.object({ identityId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: currentUserIdentityUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Identity invitation accepted or identity ended.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Pending identity invitation or active identity not found."),
    "409": jsonErrorResponse("The identity or user session changed while saving."),
    "422": jsonErrorResponse("The end date is in the future or before the identity started."),
  },
};

export const identityInvitationPreviewRouteSchema = {
  tags: ["Identities"],
  summary: "Review an emailed identity invitation",
  description:
    "A signed, expiring email link reveals the invited organization and recipient without changing identity state or requiring a login session.",
  request: {
    body: { required: true, content: { "application/json": { schema: identityInvitationLinkRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Pending invitation details.",
      content: { "application/json": { schema: identityInvitationPreviewResponseSchema } },
    },
    "404": jsonErrorResponse("Invitation link or pending identity not found."),
    "410": jsonErrorResponse("Invitation link expired."),
  },
};

export const identityInvitationAcceptRouteSchema = {
  tags: ["Identities"],
  summary: "Accept an emailed identity invitation",
  description:
    "The signed email capability activates exactly one pending identity and is consumed in the same atomic D1 command; no login session is created.",
  request: {
    body: { required: true, content: { "application/json": { schema: identityInvitationLinkRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Identity invitation accepted or identity ended.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Invitation link or pending identity not found."),
    "409": jsonErrorResponse("Invitation was already used or changed."),
    "410": jsonErrorResponse("Invitation link expired."),
  },
};

const identityReinstatementLinkBody = {
  body: { required: true, content: { "application/json": { schema: identityReinstatementLinkRequestSchema } } },
};

export const currentUserIdentityReinstatementRequestRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Ask to reinstate one of the current user's ended identities",
  description:
    "Emails a single-use link, valid for 24 hours, to the identity's own address: its selected verified address, or the person's primary address. Asking again sends a new link and retires the previous one. Nothing changes until the link is confirmed while signed in to the same account.",
  request: { params: z.object({ identityId: databaseIdSchema }) },
  responses: {
    "202": {
      description: "Reinstatement link sent.",
      content: { "application/json": { schema: identityReinstatementRequestResponseSchema } },
    },
    "404": jsonErrorResponse("Identity not found for the current user."),
    "409": jsonErrorResponse(
      "The identity cannot be reinstated (IDENTITY_NOT_ENDED, IDENTITY_NOT_REINSTATABLE, IDENTITY_SUPERSEDED, IDENTITY_CONFLICT).",
    ),
    "422": jsonErrorResponse("The identity's selected address is not verified."),
    "429": jsonErrorResponse("Too many links requested."),
  },
};

export const currentUserIdentityReinstatementPreviewRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Review an emailed identity reinstatement link",
  description: "Names the organization and address of the identity a link would reinstate, without changing it.",
  request: identityReinstatementLinkBody,
  responses: {
    "200": {
      description: "The identity the link would reinstate.",
      content: { "application/json": { schema: identityReinstatementPreviewResponseSchema } },
    },
    "403": jsonErrorResponse("The link belongs to another account (IDENTITY_REINSTATEMENT_OTHER_ACCOUNT)."),
    "404": jsonErrorResponse("The link is not valid."),
    "409": jsonErrorResponse("The link was used, or the identity can no longer be reinstated."),
    "410": jsonErrorResponse("The link expired."),
  },
};

export const currentUserIdentityReinstatementConfirmRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Confirm an emailed identity reinstatement link",
  description:
    "Redeems the latest reinstatement link once, for the signed-in account it was sent for, and reinstates the identity in the same atomic D1 command: its end date is removed, and the group seats and roles its end closed reopen where they can still be held.",
  request: identityReinstatementLinkBody,
  responses: {
    "200": {
      description: "Identity reinstated.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "403": jsonErrorResponse("The link belongs to another account (IDENTITY_REINSTATEMENT_OTHER_ACCOUNT)."),
    "404": jsonErrorResponse("The link is not valid, was replaced by a newer one, or the address changed."),
    "409": jsonErrorResponse("The link was used, or the identity can no longer be reinstated."),
    "410": jsonErrorResponse("The link expired."),
  },
};

export const identityRemoveRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Delete an incorrect identity",
  description:
    "Owners delete their own incorrect associations. Staff require membership:write and identities:activate. The user account remains. Linked participation must be reassigned before deletion.",
  "x-pkic-mcp": { expose: true, scopes: ["membership:write", "identities:activate"], readonly: false },
  request: { params: z.object({ userId: databaseIdSchema, identityId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Representation removed.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "409": jsonErrorResponse(
      "The representation is blocked, not owned, or has participation records that must be corrected first.",
    ),
  },
};

export const identitiesListRouteSchema = {
  ...requiresPermissions("membership:read"),
  tags: ["Identities"],
  summary: "List identities",
  request: { query: identitiesListQuerySchema },
  responses: {
    "200": {
      description: "A bounded identity page.",
      content: { "application/json": { schema: identitiesListResponseSchema } },
    },
    ...authErrors({ forbidden: "Membership read permission is required." }),
  },
};

export const identityCorrectionRouteSchema = {
  ...requiresSession(),
  // Owners use their human session; delegated corrections require both staff permissions.
  "x-pkic-mcp": { expose: true, scopes: ["membership:write", "identities:activate"], readonly: false },
  tags: ["Identities"],
  summary: "Correct an identity's organization association",
  description:
    "Replace an incorrect association with another active representation of the same person, move registration and speaker references, and remove the incorrect association without former-role history. Owners correct their own associations; correcting another person requires membership:write and identities:activate. Voting, membership, and succession records require review instead.",
  request: {
    params: z.object({ userId: databaseIdSchema, identityId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: identityCorrectionSchema } } },
  },
  responses: {
    "200": {
      description: "Representation corrected.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    ...authErrors({
      badRequest: "Invalid correction request.",
      forbidden: "You cannot correct this representation.",
      conflict: "The representation changed or has protected records requiring review.",
    }),
  },
};
