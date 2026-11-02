/**
 * The one answer to "what kind of mailbox is this, and which domain does it
 * speak for?" Every Worker caller — the work-email step, membership
 * eligibility, organization domain claims and linking — asks here.
 *
 * - A domain is free (consumer, ISP or shared mail) or disposable when it or a
 *   parent domain is on the vendored list (`mail.yahoo.co.uk` is Yahoo mail).
 *   The lists never hold a public suffix or a parent of one, so a parent match
 *   never reaches past the host's registrable domain.
 * - The domain an address speaks for is its registrable domain under the
 *   Public Suffix List: `alice@mail.ibm.com` speaks for `ibm.com`, and
 *   `bob@shop.example.co.uk` for `example.co.uk`.
 *
 * The lists are large, so they live only in the Worker; the browser asks
 * `GET /api/v1/email/domains/:domain` instead. Each list is a string constant
 * until first use and is split into a Set once per isolate, which keeps Worker
 * startup free of the work.
 */
import type { MailboxKind } from "../../../assets/shared/schemas/email-domains";
import { DISPOSABLE_EMAIL_DOMAINS } from "./generated/disposable-email-domains";
import { FREE_EMAIL_DOMAINS } from "./generated/free-email-domains";
import { PUBLIC_SUFFIX_RULES } from "./generated/public-suffix-rules";
import { EMAIL_DOMAIN_OVERRIDES } from "./overrides";
import { asciiHost, parsePublicSuffixRules, registrableDomainOf, type PublicSuffixRules } from "./public-suffix";

function withOverrides(data: string, overrides: { add: readonly string[]; remove: readonly string[] }): Set<string> {
  const domains = new Set(data.split("\n"));
  for (const domain of overrides.add) domains.add(domain);
  for (const domain of overrides.remove) domains.delete(domain);
  return domains;
}

// Immutable per-isolate caches, built on first use from the vendored data.
let freeDomains: ReadonlySet<string> | undefined;
let disposableDomains: ReadonlySet<string> | undefined;
let publicSuffixRules: PublicSuffixRules | undefined;

function freeSet(): ReadonlySet<string> {
  return (freeDomains ??= withOverrides(FREE_EMAIL_DOMAINS, EMAIL_DOMAIN_OVERRIDES.free));
}

function disposableSet(): ReadonlySet<string> {
  return (disposableDomains ??= withOverrides(DISPOSABLE_EMAIL_DOMAINS, EMAIL_DOMAIN_OVERRIDES.disposable));
}

function rules(): PublicSuffixRules {
  return (publicSuffixRules ??= parsePublicSuffixRules(PUBLIC_SUFFIX_RULES.split("\n")));
}

/** The ASCII host of an address (`alice@Mail.IBM.com`) or a bare domain (`ibm.com`, `@ibm.com`). */
export function emailHost(emailOrDomain: string): string | null {
  const value = emailOrDomain.trim();
  return asciiHost(value.slice(value.lastIndexOf("@") + 1));
}

/** The registrable domain an address or domain belongs to; null for a public suffix or a non-host. */
export function registrableDomain(emailOrDomain: string): string | null {
  const host = emailHost(emailOrDomain);
  return host ? registrableDomainOf(host, rules()) : null;
}

function listedWithin(emailOrDomain: string, domains: ReadonlySet<string>): boolean {
  const host = emailHost(emailOrDomain);
  if (!host) return false;
  for (let at = -1; at !== host.lastIndexOf("."); at = host.indexOf(".", at + 1))
    if (domains.has(host.slice(at + 1))) return true;
  return false;
}

/** A free, consumer, ISP or shared mailbox provider (disposable providers answer {@link isDisposableDomain}). */
export function isFreeMailDomain(emailOrDomain: string): boolean {
  return listedWithin(emailOrDomain, freeSet()) && !isDisposableDomain(emailOrDomain);
}

/** A disposable or temporary mailbox provider. */
export function isDisposableDomain(emailOrDomain: string): boolean {
  return listedWithin(emailOrDomain, disposableSet());
}

/** What an address's domain can say about its owner. */
export function mailboxKind(emailOrDomain: string): MailboxKind {
  if (isDisposableDomain(emailOrDomain)) return "disposable";
  if (isFreeMailDomain(emailOrDomain)) return "free";
  return "work";
}

/**
 * The domain a work address speaks for — its registrable domain — or null
 * when the address is free or disposable mail, or has no registrable domain.
 */
export function workEmailDomain(emailOrDomain: string): string | null {
  return mailboxKind(emailOrDomain) === "work" ? registrableDomain(emailOrDomain) : null;
}

/**
 * The domains an organization's claim could hold for a work address, most
 * specific first: the host and each parent down to its registrable domain
 * (`a.mail.ibm.com`, `mail.ibm.com`, `ibm.com`). A claim normally holds the
 * registrable domain; an explicitly linked subdomain takes precedence over
 * a broader claim. Empty for free and disposable mail.
 */
export function organizationDomainCandidates(emailOrDomain: string): string[] {
  const registrable = workEmailDomain(emailOrDomain);
  const host = emailHost(emailOrDomain);
  if (!registrable || !host) return [];
  const candidates = [host];
  for (let current = host; current !== registrable;) {
    current = current.slice(current.indexOf(".") + 1);
    candidates.push(current);
  }
  return candidates;
}

/** Every listed free and disposable domain after overrides, sorted; migration 0038 embeds this set. */
export function affiliationFreeEmailDomains(): string[] {
  return [...new Set([...freeSet(), ...disposableSet()])].sort();
}
