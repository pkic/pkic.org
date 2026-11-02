/**
 * Relying-party configuration shared by the passkey (WebAuthn) registration
 * and authentication ceremonies.
 *
 * The WebAuthn ceremony's server-held challenge is carried statelessly in a
 * short-lived signed JWT rather than a new DB table — see consolidated migration 0035's
 * header comment for the rationale.
 */
import { AppError } from "../errors";
import type { Env } from "../types";

export const PASSKEY_USER_VERIFICATION_POLICY = {
  preference: "required" as const,
  required: true,
};

export type WebAuthnEnv = Pick<
  Env,
  "WEBAUTHN_RP_ID" | "WEBAUTHN_RP_NAME" | "WEBAUTHN_ORIGIN" | "WEBAUTHN_PREVIEW_WORKER_NAME" | "INTERNAL_SIGNING_SECRET"
>;

export function requireEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(500, "WEBAUTHN_CONFIG_MISSING", `${name} is not configured`);
  }
  return value;
}

export function expectedPasskeyOrigin(env: WebAuthnEnv, requestUrl: string): string {
  const configuredOrigin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const requestOrigin = new URL(requestUrl);
  if (requestOrigin.origin === configuredOrigin) return configuredOrigin;

  const workerName = env.WEBAUTHN_PREVIEW_WORKER_NAME;
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const previewSuffix = workerName && `-${workerName}.${rpId}`;
  const alias =
    previewSuffix && requestOrigin.hostname.endsWith(previewSuffix)
      ? requestOrigin.hostname.slice(0, -previewSuffix.length)
      : "";
  if (
    requestOrigin.protocol === "https:" &&
    requestOrigin.port === "" &&
    alias.length > 0 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(alias)
  ) {
    return requestOrigin.origin;
  }

  throw new AppError(400, "PASSKEY_ORIGIN_INVALID", "Passkeys are unavailable on this hostname");
}
