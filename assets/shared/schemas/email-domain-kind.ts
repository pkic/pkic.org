import { z } from "zod";

/**
 * Whether a contact address is a consumer mailbox ("personal") or not
 * ("work"), as organizers and sponsors see it: a personal-mailbox contact is
 * marked as such, never with an organization, so they can weigh it. The
 * Worker decides it from its vendored lists
 * (`functions/_lib/email-domains/contact-kind.ts`); the browser only reads it.
 */
export const emailDomainKindSchema = z.enum(["personal", "work"]);
export type EmailDomainKind = z.infer<typeof emailDomainKindSchema>;
