/**
 * Passkey (WebAuthn) API schemas.
 *
 * `options` in the /begin responses is the opaque
 * PublicKeyCredentialCreationOptionsJSON / PublicKeyCredentialRequestOptionsJSON
 * object handed directly to `startRegistration()`/`startAuthentication()`
 * (@simplewebauthn/browser) — its shape is dictated by the WebAuthn spec,
 * not this app, so it's documented here as an opaque object rather than
 * fully modeled field-by-field.
 */
import { z } from "zod";
import { userIdentitySchema } from "./user-auth";
import { databaseIdSchema } from "./identifiers";
import { successResponseSchema } from "./api-common";
import { publicAuthAdminSchema } from "./admin-auth";
import { authMemberSchema } from "./member-auth";

export const passkeyIdParamsSchema = z.object({ id: databaseIdSchema });

const webauthnOptionsSchema = z.record(z.string(), z.unknown());

/** Fields present on every WebAuthn PublicKeyCredential JSON response. */
export const publicKeyCredentialEnvelopeSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  type: z.literal("public-key"),
});

export const registrationResponseSchema = publicKeyCredentialEnvelopeSchema.extend({
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional(),
    authenticatorData: z.string().optional(),
    publicKey: z.string().optional(),
    publicKeyAlgorithm: z.number().optional(),
  }),
});

export const authenticationResponseSchema = publicKeyCredentialEnvelopeSchema.extend({
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
});

export const passkeyRegisterCompleteSchema = z.object({
  challengeToken: z.string().min(1),
  response: registrationResponseSchema,
  deviceName: z.string().trim().min(1).max(120).nullable().optional(),
});

export const passkeyAuthenticateCompleteSchema = z.object({
  challengeToken: z.string().min(1),
  response: authenticationResponseSchema,
});

export const passkeyBeginResponseSchema = z.object({
  options: webauthnOptionsSchema,
  challengeToken: z.string(),
});

export const passkeySummarySchema = z.object({
  id: databaseIdSchema,
  deviceName: z.string().nullable(),
  aaguid: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;
export const passkeysListResponseSchema = z.object({ passkeys: z.array(passkeySummarySchema) });

export const passkeyAuthenticateCompleteBaseResponseSchema = successResponseSchema.extend({ expiresAt: z.string() });
export const passkeyAuthenticateCompleteResponseSchema = passkeyAuthenticateCompleteBaseResponseSchema
  .extend({
    identity: userIdentitySchema,
    staff: publicAuthAdminSchema.optional(),
    member: authMemberSchema.optional(),
  })
  .refine((value) => value.staff !== undefined || value.member !== undefined, {
    message: "At least one authenticated capacity is required",
  });

export const passkeyRegisterBeginRouteSchema = {
  tags: ["Passkeys"],
  summary: "Begin passkey registration",
  description: "Returns WebAuthn PublicKeyCredentialCreationOptions for an authenticated user.",
  responses: {
    "200": {
      description: "Registration options.",
      content: { "application/json": { schema: passkeyBeginResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "409": { description: "The account has reached its active passkey limit." },
  },
};

export const passkeyRegisterCompleteRouteSchema = {
  tags: ["Passkeys"],
  summary: "Complete passkey registration",
  description: "Verifies the credential and stores it in passkey_credentials.",
  request: {
    body: { content: { "application/json": { schema: passkeyRegisterCompleteSchema } }, required: true },
  },
  responses: {
    "201": { description: "Passkey registered.", content: { "application/json": { schema: passkeySummarySchema } } },
    "400": { description: "Invalid credential or challenge." },
    "401": { description: "Authentication required." },
    "409": { description: "This passkey is already registered or the account has reached its active passkey limit." },
  },
};

export const passkeyAuthenticateBeginRouteSchema = {
  tags: ["Passkeys"],
  summary: "Begin passkey authentication",
  description: "Discovery flow, no authentication required.",
  responses: {
    "200": {
      description: "Authentication options.",
      content: { "application/json": { schema: passkeyBeginResponseSchema } },
    },
  },
};

export const passkeyAuthenticateCompleteRouteSchema = {
  tags: ["Passkeys"],
  summary: "Complete passkey authentication",
  description:
    "Verifies the assertion and creates one user session with every currently eligible staff/member capacity.",
  request: {
    body: { content: { "application/json": { schema: passkeyAuthenticateCompleteSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Session created.",
      content: { "application/json": { schema: passkeyAuthenticateCompleteResponseSchema } },
    },
    "400": { description: "Invalid assertion, challenge, or replayed sign count." },
    "403": { description: "Account is no longer eligible to sign in." },
  },
};

export const passkeysListRouteSchema = {
  tags: ["Passkeys"],
  summary: "List the authenticated user's passkeys",
  responses: {
    "200": {
      description: "Registered passkeys (no key material).",
      content: { "application/json": { schema: passkeysListResponseSchema } },
    },
    "401": { description: "Authentication required." },
  },
};

export const passkeyDeleteRouteSchema = {
  tags: ["Passkeys"],
  summary: "Remove a passkey",
  request: { params: passkeyIdParamsSchema },
  responses: {
    "200": { description: "Passkey removed." },
    "401": { description: "Authentication required." },
    "403": { description: "Cannot remove another user's passkey." },
    "404": { description: "Passkey not found." },
  },
};
