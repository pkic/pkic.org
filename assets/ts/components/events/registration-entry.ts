import type { FlowBoot } from "../../event-flows/boot";
import type { RegistrationEntry } from "../../../shared/schemas/registration-email-proof";
import { sourceTypeSchema } from "../../../shared/schemas/source";

/** Preserve invitation and attribution context in every registration embedding. */
export function registrationEntry(query: FlowBoot["query"]): RegistrationEntry {
  const sourceType = sourceTypeSchema.safeParse(query.sourceType);
  return {
    inviteToken: query.inviteToken ?? undefined,
    inviteId: query.inviteToken ? (query.inviteId ?? undefined) : undefined,
    referralCode: query.referralCode ?? undefined,
    sourceType: sourceType.success ? sourceType.data : undefined,
  };
}
