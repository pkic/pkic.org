/**
 * Common personal-email provider policy shared by browser advisories and
 * backend membership eligibility checks. Keep product policy here so request
 * schemas and legacy submission adapters cannot drift.
 */
export const PERSONAL_EMAIL_DOMAINS = [
  "aim.com",
  "aol.com",
  "fastmail.com",
  "fastmail.fm",
  "gmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.de",
  "hotmail.fr",
  "hotmail.it",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "live.de",
  "live.nl",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.co.uk",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.ch",
  "protonmail.com",
  "tuta.io",
  "tutanota.com",
  "yahoo.co.uk",
  "yahoo.com",
  "yahoo.de",
  "yahoo.fr",
  "yahoo.it",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
] as const;

const PERSONAL_EMAIL_DOMAIN_SET = new Set<string>(PERSONAL_EMAIL_DOMAINS);

export function emailDomainOf(email: string): string {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  return separator < 0 ? "" : normalized.slice(separator + 1);
}

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAIN_SET.has(domain.trim().toLowerCase());
}

export function isPersonalEmailAddress(email: string): boolean {
  const domain = emailDomainOf(email);
  return domain.length > 0 && isPersonalEmailDomain(domain);
}
