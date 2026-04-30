/**
 * DNS MX record check using Cloudflare DNS-over-HTTPS.
 *
 * Used to validate that an email domain has at least one MX record before
 * accepting it in registration flows. This is a fast, reliable supplement to
 * format-based email validation and catches typos in the domain part early.
 *
 * Fails open: if the DNS lookup itself fails (network error, timeout, etc.)
 * the function returns `true` so that a temporary DNS failure does not block
 * legitimate registrations.
 */

/** Result returned by checkEmailDomainMx. */
export interface MxCheckResult {
  /** true if the domain has MX records (or the check could not be completed). */
  valid: boolean;
  /** false only when we received a definitive "no MX records" response. */
  hasMxRecords: boolean;
}

/**
 * Extracts the domain from an email address string.
 * Expects a pre-validated, normalised email (lower-cased, trimmed).
 */
function domainFromEmail(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 1) return null;
  const domain = email.slice(atIndex + 1);
  return domain.length > 0 ? domain : null;
}

/**
 * Checks whether the domain portion of `email` has at least one MX record.
 *
 * Uses Cloudflare's DNS-over-HTTPS JSON API (1.1.1.1).
 * Returns `{ valid: true, hasMxRecords: true }` on any lookup failure so that
 * transient DNS issues never block a registration.
 */
export async function checkEmailDomainMx(email: string): Promise<MxCheckResult> {
  const domain = domainFromEmail(email);
  if (!domain) {
    return { valid: false, hasMxRecords: false };
  }

  try {
    const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      // 3-second timeout — fast enough for a registration submit, long enough
      // not to penalise slow resolvers.
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      // Upstream DNS error — fail open.
      return { valid: true, hasMxRecords: true };
    }

    const data = (await response.json()) as { Status: number; Answer?: Array<{ type: number }> };

    // Status 0 = NOERROR, Status 3 = NXDOMAIN (domain does not exist in DNS).
    // A non-existent domain cannot receive mail.
    if (data.Status === 3) {
      return { valid: false, hasMxRecords: false };
    }

    // Answer array may be absent or empty when Status is 0 but no MX records exist.
    const hasMx = Array.isArray(data.Answer) && data.Answer.some((rr) => rr.type === 15 /* MX record type */);

    if (!hasMx) {
      return { valid: false, hasMxRecords: false };
    }

    return { valid: true, hasMxRecords: true };
  } catch {
    // Network error, timeout, JSON parse failure — fail open.
    return { valid: true, hasMxRecords: true };
  }
}
