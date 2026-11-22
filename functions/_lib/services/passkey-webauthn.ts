/**
 * Relying-party configuration shared by the passkey (WebAuthn) registration
 * and authentication ceremonies.
 *
 * The WebAuthn ceremony's server-held challenge is carried statelessly in a
 * short-lived signed JWT rather than a new DB table — see consolidated migration 0035's
 * header comment for the rationale.
 */
import { PREVIEW_HOSTNAME, previewOriginIdentity } from "../../../assets/shared/preview-domain";
import { AppError } from "../errors";
import type { Env } from "../types";

export const PASSKEY_USER_VERIFICATION_POLICY = {
  preference: "required" as const,
  required: true,
};

export type WebAuthnEnv = Pick<
  Env,
  "WEBAUTHN_RP_ID" | "WEBAUTHN_RP_NAME" | "WEBAUTHN_ORIGIN" | "INTERNAL_SIGNING_SECRET"
>;

export function requireEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(500, "WEBAUTHN_CONFIG_MISSING", `${name} is not configured`);
  }
  return value;
}

export function expectedPasskeyIdentity(env: WebAuthnEnv, requestUrl: string): { origin: string; rpId: string } {
  const configuredOrigin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const requestOrigin = new URL(requestUrl).origin;
  if (requestOrigin === configuredOrigin) return { origin: configuredOrigin, rpId };

  // Existing workers.dev credentials remain usable on that origin during migration.
  // This fallback is never enabled by production's pkic.org RP configuration.
  if (rpId === PREVIEW_HOSTNAME && previewOriginIdentity(configuredOrigin)?.rpId === PREVIEW_HOSTNAME) {
    const preview = previewOriginIdentity(requestUrl);
    if (preview) return preview;
  }
  throw new AppError(400, "PASSKEY_ORIGIN_INVALID", "Passkeys are unavailable on this hostname");
}
