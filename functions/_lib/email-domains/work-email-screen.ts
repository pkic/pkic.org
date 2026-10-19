import { workEmailStepForKindSchema } from "../../../assets/shared/schemas/work-email";
import { AppError } from "../errors";
import { mailboxKind } from "./classification";

/**
 * Holds a parsed work-email step to the shared rule with the address's kind
 * from the vendored lists. A refusal uses the validation envelope a schema
 * refusal uses, so the browser reads it onto the email field.
 */
export function refuseIneligibleWorkEmail(step: { email: string; unaffiliatedAttestation: boolean }): void {
  const result = workEmailStepForKindSchema(mailboxKind(step.email)).safeParse(step);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid request", result.error.flatten());
}
