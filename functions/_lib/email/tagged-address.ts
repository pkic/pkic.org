export interface TaggedInboundAddress {
  baseLocal: string;
  domain: string;
  tag: string;
}

export interface BaseEmailAddress {
  baseLocal: string;
  domain: string;
}

/** Parses a base mailbox and strips any existing sub-address tag. */
export function parseBaseEmailAddress(baseEmail: string): BaseEmailAddress | null {
  const atIndex = baseEmail.indexOf("@");
  if (atIndex <= 0 || atIndex !== baseEmail.lastIndexOf("@") || atIndex === baseEmail.length - 1) return null;
  const baseLocal = baseEmail.slice(0, atIndex).split("+", 1)[0];
  const domain = baseEmail.slice(atIndex + 1);
  return baseLocal && domain ? { baseLocal, domain } : null;
}

/**
 * Extracts the untrusted tag from an inbound sub-address. Domain and base-local
 * matching retain the existing case-insensitive inbound-mail behavior; callers
 * remain responsible for validating and authenticating the returned tag.
 */
export function parseTaggedInboundAddress(emailAddress: string, baseEmail: string): TaggedInboundAddress | null {
  const base = parseBaseEmailAddress(baseEmail);
  if (!base) return null;

  const atIndex = emailAddress.indexOf("@");
  if (atIndex <= 0 || atIndex !== emailAddress.lastIndexOf("@") || atIndex === emailAddress.length - 1) return null;
  const local = emailAddress.slice(0, atIndex);
  const domain = emailAddress.slice(atIndex + 1);
  const prefix = `${base.baseLocal}+`;
  if (domain.toLowerCase() !== base.domain.toLowerCase() || !local.toLowerCase().startsWith(prefix.toLowerCase())) {
    return null;
  }
  const tag = local.slice(prefix.length);
  return tag ? { ...base, tag } : null;
}
