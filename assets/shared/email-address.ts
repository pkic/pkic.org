/**
 * One spelling per email address. An internationalized domain such as
 * `bücher.example` is stored and compared in its ASCII (punycode) form,
 * `xn--bcher-kva.example`, which is what mail servers resolve. The local part
 * is kept as typed apart from case.
 */

/** Characters that end a host in a URL; a domain holding one is left for validation to refuse. */
const NOT_A_HOST = /[\s/?#:@\\[\]%]/u;

/** The address with its domain in ASCII; anything not shaped like an address is returned unchanged. */
export function asciiEmailDomain(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  const domain = value.slice(at + 1);
  if (!/[\u0080-￿]/u.test(domain) || NOT_A_HOST.test(domain)) return value;
  try {
    // The WHATWG URL parser applies IDNA (UTS #46) in browsers, Node, and the Worker alike.
    return `${value.slice(0, at)}@${new URL(`http://${domain}`).hostname}`;
  } catch {
    return value;
  }
}

/**
 * Zod's address pattern, with one widening: a top-level domain may be an
 * internationalized one in its punycode form (`xn--…`), as `.рф` becomes.
 */
export const EMAIL_ADDRESS_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]+)$/u;

/** The stored, compared form of an address: trimmed, domain in ASCII, lower case. */
export function normalizeEmailAddress(value: string): string {
  return asciiEmailDomain(value.trim()).toLowerCase();
}
