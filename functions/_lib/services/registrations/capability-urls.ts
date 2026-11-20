import { AppError } from "../../errors";
import { queuedCapabilityTokenBoundToSecret } from "../capability-links";
import { registrationConfirmPageUrl, registrationManagePageUrl, type RegistrationRouteSource } from "../frontend-links";
import type { RegistrationRecord } from "./types";

const REGISTRATION_MANAGE_CAPABILITY_TTL_SECONDS = 30 * 24 * 60 * 60;

type RegistrationConfirmationEvent = Pick<
  RegistrationRouteSource,
  "slug" | "base_path" | "starts_at" | "settings_json"
>;

/**
 * Creates an outbox-only registration-management capability bound to the
 * exact secret generation at enqueue time. The raw secret never enters the
 * queued payload, so a delayed message cannot mint authority after rotation.
 */
export async function registrationManageCapability(
  appBaseUrl: string,
  event: RegistrationRouteSource,
  registration: Pick<RegistrationRecord, "id" | "manage_link_secret">,
): Promise<{ manageToken: string; manageUrl: string }> {
  if (!registration.manage_link_secret) {
    throw new AppError(409, "MANAGE_LINK_UNAVAILABLE", "Registration management is no longer available");
  }
  const manageToken = await queuedCapabilityTokenBoundToSecret(
    "registration_manage",
    registration.id,
    registration.manage_link_secret,
    REGISTRATION_MANAGE_CAPABILITY_TTL_SECONDS,
  );
  return {
    manageToken,
    manageUrl: registrationManagePageUrl(appBaseUrl, event, { token: manageToken, registrationId: registration.id }),
  };
}

/** Creates a confirmation URL bound to the exact confirmation-secret generation at enqueue time. */
export async function registrationConfirmationUrl(
  appBaseUrl: string,
  event: RegistrationConfirmationEvent,
  registration: Pick<RegistrationRecord, "id" | "confirmation_link_secret">,
  confirmationTtlHours: number,
): Promise<string> {
  if (!registration.confirmation_link_secret) {
    throw new AppError(409, "CONFIRMATION_UNAVAILABLE", "Registration confirmation is no longer available");
  }
  const token = await queuedCapabilityTokenBoundToSecret(
    "registration_confirm",
    registration.id,
    registration.confirmation_link_secret,
    confirmationTtlHours * 60 * 60,
  );
  return registrationConfirmPageUrl(appBaseUrl, event, token, registration.id);
}
