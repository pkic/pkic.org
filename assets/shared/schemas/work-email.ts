import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import type { MailboxKind } from "./email-domains";
import { DISPOSABLE_EMAIL_REFUSED, WORK_EMAIL_STEER } from "../email-first-copy";

/**
 * The email-first step every public entry starts from: an address, and
 * whether the person takes part without an organization. `unaffiliatedAttestation`
 * is that explicit individual capacity — never inferred from the address.
 */
export const workEmailStepSchema = z.object({
  email: normalizedEmailSchema,
  unaffiliatedAttestation: z.boolean().default(false),
});
export type WorkEmailStep = z.infer<typeof workEmailStepSchema>;

/**
 * The one work-email rule, given what kind of mailbox the address is: a
 * disposable mailbox is never accepted; a free one only for someone taking
 * part as an individual. The kind comes from the Worker's lists — directly on
 * the server, through `GET /api/v1/email/domains/:domain` in the browser.
 */
export function refineWorkEmailDomain(
  input: { unaffiliatedAttestation: boolean },
  kind: MailboxKind,
  context: z.core.$RefinementCtx,
): void {
  if (kind === "disposable") context.addIssue({ code: "custom", path: ["email"], message: DISPOSABLE_EMAIL_REFUSED });
  else if (kind === "free" && !input.unaffiliatedAttestation)
    context.addIssue({ code: "custom", path: ["email"], message: WORK_EMAIL_STEER });
}

/** The work-email step held to the rule for a domain of the given kind. */
export function workEmailStepForKindSchema(kind: MailboxKind) {
  return workEmailStepSchema.superRefine((input, context) => refineWorkEmailDomain(input, kind, context));
}

/**
 * Marks a route whose JSON body carries a work-email step (`email` and
 * `unaffiliatedAttestation`). After the body parses, the Worker applies
 * {@link refineWorkEmailDomain} with the address's kind and refuses through the
 * shared validation envelope, so the browser reads the steer onto its field.
 */
export function screensWorkEmailDomain() {
  return { "x-pkic-work-email-domain": true } as const;
}
