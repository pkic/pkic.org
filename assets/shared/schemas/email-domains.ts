/**
 * Email domains as the API speaks of them: a bare domain name, and what kind
 * of mailbox a domain is.
 *
 * Which domains are free or disposable is decided only in the Worker, against
 * the vendored lists in `functions/_lib/email-domains` (thousands of entries
 * the browser never downloads). The browser asks `GET /api/v1/email/domains/:domain`
 * and applies the shared work-email rule (`work-email.ts`) to the answer.
 */
import { z } from "zod";
import { ok, publicErrors, publicOperation } from "./route-contract";

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** A bare email domain: `@example.com` and `Example.COM` both read as `example.com`. */
export const emailDomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ""))
  .pipe(z.string().regex(DOMAIN_PATTERN, { error: "Enter a domain such as example.com." }));

/**
 * `work`: the domain may speak for an organization. `free`: a consumer, ISP or
 * shared mailbox provider. `disposable`: a throwaway mailbox provider.
 */
export const MAILBOX_KINDS = ["work", "free", "disposable"] as const;
export const mailboxKindSchema = z.enum(MAILBOX_KINDS);
export type MailboxKind = z.infer<typeof mailboxKindSchema>;

/** The domain part of an address, lower-cased; empty when there is none. */
export function emailDomainOf(email: string): string {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  return separator < 0 ? "" : normalized.slice(separator + 1);
}

export const emailDomainParamsSchema = z.object({ domain: emailDomainNameSchema });

export const emailDomainResponseSchema = z.object({
  domain: z.string(),
  kind: mailboxKindSchema,
});
export type EmailDomainResponse = z.infer<typeof emailDomainResponseSchema>;

export function emailDomainUrl(domain: string): string {
  return `/api/v1/email/domains/${encodeURIComponent(domain)}`;
}

export const emailDomainRouteSchema = {
  ...publicOperation(),
  tags: ["Public"],
  summary: "Classify an email domain",
  description:
    "Says whether a domain is free or shared mail (ISPs included), disposable mail, or a domain that may speak for an organization, against the vendored open-source lists. A subdomain of a listed provider is that provider.",
  request: { params: emailDomainParamsSchema },
  responses: {
    ...ok("The domain's kind.", emailDomainResponseSchema),
    ...publicErrors({ badRequest: "Invalid domain.", tooManyRequests: "Too many lookups from this network." }),
  },
};
