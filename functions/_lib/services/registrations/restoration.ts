import { AppError } from "../../errors";
import type { RegistrationRecord } from "./types";

/** An abuse report requires a deliberate organizer restoration, not automatic admission. */
export function assertRegistrationRestorationAllowed(
  registration: Pick<RegistrationRecord, "status" | "cancellation_reason_code">,
): void {
  if (registration.status === "cancelled" && registration.cancellation_reason_code === "unauthorized_registration") {
    throw new AppError(
      409,
      "UNAUTHORIZED_REGISTRATION_REVIEW_REQUIRED",
      "This registration was reported as unauthorized and must be reviewed by an organizer before it can be restored",
    );
  }
}
