import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import type { RegistrationRecord } from "./types";
import { AppError } from "../../errors";

/** Guards a registration-derived plan against a concurrent lifecycle change. */
export function prepareRegistrationTransitionGuard(db: DatabaseLike, registration: RegistrationRecord): StatementLike {
  return db
    .prepare(
      `INSERT INTO registration_transition_guards (id, registration_id, expected_revision)
       VALUES (?, ?, ?)`,
    )
    .bind(uuid(), registration.id, registration.transition_revision);
}

/** D1 exposes the trigger's deliberate compare-and-set failure as SQL text. */
export function isRegistrationTransitionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("REGISTRATION_CHANGED");
}

/** Stable API-level representation of the registration transition guard. */
export function registrationChangedError(): AppError {
  return new AppError(
    409,
    "REGISTRATION_CHANGED",
    "Registration changed while this operation was processed. Please retry.",
  );
}
