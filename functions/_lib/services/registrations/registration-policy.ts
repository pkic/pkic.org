import { AppError } from "../../errors";

/** Whether an event takes registrations at all; an automatic meeting invites its group itself (#103). */
export function eventTakesRegistrations(registrationMode: string): boolean {
  return registrationMode !== "no_registration" && registrationMode !== "automatic";
}

/** Whether anyone signed in may register, without an invitation or group access. */
export function registrationAllowsPublicAccess(registrationMode: string): boolean {
  return registrationMode === "public" || registrationMode === "open" || registrationMode === "invite_or_open";
}

const ACCESS_CONTROLLED_MODES = new Set(["optional", "required", "invitation_only", "invite_only"]);

/** Refuses a registration the event's mode does not admit for this person's access. */
export function requireRegistrationPolicy(
  registrationMode: string,
  access: { invited: boolean; authorizedByGroup: boolean },
): void {
  if (!eventTakesRegistrations(registrationMode)) {
    throw new AppError(403, "EVENT_REGISTRATION_DISABLED", "This event does not use registration");
  }
  if (registrationAllowsPublicAccess(registrationMode)) return;
  if (ACCESS_CONTROLLED_MODES.has(registrationMode) && (access.invited || access.authorizedByGroup)) return;
  throw new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration requires an invitation or group access");
}
