/**
 * Phase 3 (PRD §3) passkey (WebAuthn) API schemas.
 *
 * `options` in the /begin responses is the opaque
 * PublicKeyCredentialCreationOptionsJSON / PublicKeyCredentialRequestOptionsJSON
 * object handed directly to `startRegistration()`/`startAuthentication()`
 * (@simplewebauthn/browser) — its shape is dictated by the WebAuthn spec,
 * not this app, so it's documented here as an opaque object rather than
 * fully modeled field-by-field.
 */
import { z } from "zod";

export const passkeyIdParamsSchema = z.object({ id: z.uuid() });

const webauthnOptionsSchema = z.record(z.string(), z.unknown());

export const registrationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional(),
    authenticatorData: z.string().optional(),
    publicKey: z.string().optional(),
    publicKeyAlgorithm: z.number().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  type: z.literal("public-key"),
});

export const authenticationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  type: z.literal("public-key"),
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
  id: z.uuid(),
  deviceName: z.string().nullable(),
  aaguid: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const passkeyAuthenticateCompleteResponseSchema = z.object({
  success: z.literal(true),
  expiresAt: z.string(),
  admin: z.object({ id: z.string(), email: z.string(), role: z.string() }),
});

export const passkeyRegisterBeginRouteSchema = {
  tags: ["Passkeys"],
  summary: "Begin passkey registration",
  description: "PRD §3.4 — returns WebAuthn PublicKeyCredentialCreationOptions for an authenticated user.",
  responses: {
    "200": {
      description: "Registration options.",
      content: { "application/json": { schema: passkeyBeginResponseSchema } },
    },
    "401": { description: "Authentication required." },
  },
};

export const passkeyRegisterCompleteRouteSchema = {
  tags: ["Passkeys"],
  summary: "Complete passkey registration",
  description: "PRD §3.4 — verifies the credential and stores it in passkey_credentials.",
  request: {
    body: { content: { "application/json": { schema: passkeyRegisterCompleteSchema } }, required: true },
  },
  responses: {
    "201": { description: "Passkey registered.", content: { "application/json": { schema: passkeySummarySchema } } },
    "400": { description: "Invalid credential or challenge." },
    "401": { description: "Authentication required." },
    "409": { description: "This passkey is already registered." },
  },
};

export const passkeyAuthenticateBeginRouteSchema = {
  tags: ["Passkeys"],
  summary: "Begin passkey authentication",
  description: "PRD §3.4 — discovery flow, no authentication required.",
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
  description: "PRD §3.4 — verifies the assertion and creates a session, same as magic-link verification.",
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
      content: { "application/json": { schema: z.object({ passkeys: z.array(passkeySummarySchema) }) } },
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
