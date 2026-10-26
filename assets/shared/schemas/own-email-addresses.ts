/**
 * The signed-in person's own email addresses (`/api/v1/users/current/emails`).
 *
 * The primary address lives on the account; every other address is a
 * `user_emails` row, the same rows staff manage. A person adds an address,
 * proves it through an emailed link and confirms linking while signed in to the same account
 * (`/api/v1/auth/email-verifications`), may make a verified one primary, and
 * removes one no organization identity uses. A verified work address joins
 * the organization its domain belongs to through the shared domain rule.
 */
import { z } from "zod";
import { jsonErrorResponse, magicLinkVerifySchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { verifiedEmailIdentitySchema } from "./identity";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, capabilityErrors, ok, publicOperation, requiresSession } from "./route-contract";
import { USER_EMAILS_SORT_COLUMNS, userEmailAddSchema } from "./user-emails";

/** A person keeps at most this many addresses besides their primary one. */
export const OWN_EMAIL_ADDRESS_LIMIT = 10;
/** A verification link proves the mailbox only; it stays usable for this long. */
export const EMAIL_ADDRESS_VERIFICATION_TTL_HOURS = 24;

/**
 * One of the signed-in person's addresses: the profile's address shape (the
 * primary address has no id of its own; `verifiedAt` is null while the
 * address awaits verification), plus when it was added.
 */
export const ownEmailAddressSchema = verifiedEmailIdentitySchema.extend({
  createdAt: z.string(),
  signInEnabled: z.boolean(),
});
export type OwnEmailAddress = z.infer<typeof ownEmailAddressSchema>;

export const ownEmailAddressesListQuerySchema = listQuerySchema(USER_EMAILS_SORT_COLUMNS, { limit: 20 });
export type OwnEmailAddressesListQuery = z.infer<typeof ownEmailAddressesListQuerySchema>;
export const ownEmailAddressesListResponseSchema = paginatedResponseSchema("emails", ownEmailAddressSchema);
export const ownEmailAddressResponseSchema = z.object({ email: ownEmailAddressSchema });

export const ownEmailAddressAddSchema = userEmailAddSchema;
export const ownEmailVerificationRequestedResponseSchema = z.object({
  status: z.literal("verification_sent"),
  email: z.string(),
  requestId: databaseIdSchema,
});
export const ownEmailAddressParamsSchema = z.object({ emailId: databaseIdSchema });
/** Account access requires a separate, explicit choice after mailbox verification. */
export const ownEmailAddressUpdateSchema = z.union([
  z.object({ primary: z.literal(true) }).strict(),
  z.object({ signInEnabled: z.boolean() }).strict(),
]);
export type OwnEmailAddressUpdate = z.infer<typeof ownEmailAddressUpdateSchema>;
/** The emailed link's token, sent back by the page the link opens. */
export const ownEmailAddressVerificationSchema = magicLinkVerifySchema.extend({
  consolidateUnverifiedAccount: z.boolean().optional(),
});

const organizationReferenceSchema = z.object({ id: databaseIdSchema, name: z.string() });

/** What an opened link names, before anything changes. */
export const ownEmailAddressVerificationPreviewResponseSchema = z.object({
  email: z.string(),
  accountEmail: z.string(),
  consolidatesUnverifiedAccount: z.boolean(),
});

export const ownEmailAddressVerificationResponseSchema = z.object({
  email: z.string(),
  /** The organization the verified work address joined automatically, if any. */
  joinedOrganization: organizationReferenceSchema.nullable(),
  /** A member organization the address belongs to; the person signs in to join it themselves. */
  offeredOrganization: organizationReferenceSchema.nullable(),
});

export const ownEmailAddressesListRouteSchema = {
  tags: ["Users"],
  ...requiresSession(),
  summary: "List the current user's email addresses",
  description: "The primary address and every added address, verified or awaiting verification.",
  request: { query: ownEmailAddressesListQuerySchema },
  responses: {
    ...ok("The current user's addresses.", ownEmailAddressesListResponseSchema),
    ...authErrors({ badRequest: "Invalid list query." }),
  },
};

export const ownEmailAddressAddRouteSchema = {
  tags: ["Users"],
  ...requiresSession(),
  summary: "Add an email address to the current user",
  description:
    "Sends a verification link. The address is saved only after mailbox proof and confirmation by this account. Rate limited per address and network.",
  request: { body: { required: true, content: { "application/json": { schema: ownEmailAddressAddSchema } } } },
  responses: {
    "202": {
      description: "Verification requested; no address is saved before proof.",
      content: { "application/json": { schema: ownEmailVerificationRequestedResponseSchema } },
    },
    ...authErrors({
      badRequest: "Invalid email address.",
      conflict: "The address is already in use, or the address limit is reached.",
      tooManyRequests: "Too many verification emails; try again later.",
    }),
  },
};

export const ownEmailAddressVerificationRequestRouteSchema = {
  tags: ["Users"],
  ...requiresSession(),
  summary: "Send a new verification link to one of the current user's addresses",
  request: { params: ownEmailAddressParamsSchema },
  responses: {
    "202": {
      description: "A verification link was sent.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    ...authErrors({
      notFound: "Address not found.",
      conflict: "The address is already verified.",
      tooManyRequests: "Too many verification emails; try again later.",
    }),
  },
};

export const ownEmailAddressVerificationPreviewRouteSchema = {
  tags: ["Authentication"],
  ...publicOperation(),
  summary: "Review an emailed email address verification link",
  description:
    "The signed, expiring link names the address it verifies without changing anything or requiring a session, so a mail scanner opening it verifies nothing.",
  request: {
    body: { required: true, content: { "application/json": { schema: ownEmailAddressVerificationSchema } } },
  },
  responses: {
    ...ok("The address the link verifies.", ownEmailAddressVerificationPreviewResponseSchema),
    ...capabilityErrors({ notFound: "Link or address not found.", conflict: "The address is already verified." }),
    "410": jsonErrorResponse("The link expired."),
  },
};

export const ownEmailAddressVerificationRouteSchema = {
  tags: ["Authentication"],
  ...requiresSession(),
  summary: "Verify an email address with its emailed link",
  description:
    "The single-use, 24-hour link proves the mailbox; the same signed-in account must explicitly confirm linking it. A work address then joins the organization its domain belongs to when that is automatic; a member organization is offered, and the person signs in only to answer it.",
  request: {
    body: { required: true, content: { "application/json": { schema: ownEmailAddressVerificationSchema } } },
  },
  responses: {
    ...ok("Address verified.", ownEmailAddressVerificationResponseSchema),
    ...capabilityErrors({ notFound: "Link or address not found.", conflict: "The link was already used." }),
    "410": jsonErrorResponse("The link expired."),
  },
};

export const ownEmailAddressUpdateRouteSchema = {
  tags: ["Users"],
  ...requiresSession(),
  summary: "Update primary-address or sign-in choices for an owned address",
  description:
    "Making an address primary preserves organization identity addresses. Enabling sign-in separately grants full account access through a verified, currently authorized address.",
  request: {
    params: ownEmailAddressParamsSchema,
    body: { required: true, content: { "application/json": { schema: ownEmailAddressUpdateSchema } } },
  },
  responses: {
    ...ok("Primary address changed.", ownEmailAddressResponseSchema),
    ...authErrors({
      notFound: "Address not found.",
      conflict: "The address is unverified, or the account changed meanwhile.",
    }),
  },
};

export const ownEmailAddressRemoveRouteSchema = {
  tags: ["Users"],
  ...requiresSession(),
  summary: "Remove one of the current user's non-primary addresses",
  request: { params: ownEmailAddressParamsSchema },
  responses: {
    ...ok("Address removed.", successResponseSchema),
    ...authErrors({ notFound: "Address not found.", conflict: "An organization identity uses the address." }),
  },
};
