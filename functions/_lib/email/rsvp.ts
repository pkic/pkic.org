import { hmacSha256Hex } from "../utils/crypto";

/**
 * Returns a signed email address for RSVP and bounce tracking using sub-addressing.
 *
 * Compact format (single-day):  [baseLocal]+[regId32]-[sig8]@[domain]
 * Compact format (per-day):     [baseLocal]+[regId32]-[date8]-[sig8]@[domain]
 *
 * UUID hyphens and date hyphens are stripped so the local part fits within the
 * 64-character RFC 5321 limit even for environments with a longer base prefix.
 * The HMAC payload still uses the original values (with hyphens) so verification
 * can reconstruct them without storing anything extra.
 *
 * The per-day date in the address lets implicit email replies (Outlook/Apple Mail
 * subject-line declines without an ICS attachment) be mapped back to the correct day.
 */
export async function generateSignedRsvpAddress(
  registrationId: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org",
  dayDate?: string,
): Promise<string> {
  // HMAC payload uses canonical values (hyphens preserved)
  const payload = dayDate ? `${registrationId}-${dayDate}` : registrationId;
  const hmac = await hmacSha256Hex(secret, payload);
  const signature = hmac.substring(0, 8);

  const [localPart, domain] = baseEmail.split("@");
  if (!domain) throw new Error("Invalid base email");
  // Strip any existing sub-address (e.g. if baseEmail is already a signed address)
  const baseLocal = localPart.split("+")[0];

  // sub-address appended: +{hex32}-{YYYYMMDD}-{hex8} = 1+32+1+8+1+8 = 51 chars
  // RFC 5321 local-part limit is 64 chars, so base must be ≤ 13
  const MAX_BASE_LOCAL = 13;
  if (baseLocal.length > MAX_BASE_LOCAL) {
    throw new Error(
      `RSVP base email local part "${baseLocal}" is ${baseLocal.length} chars; ` +
      `max allowed is ${MAX_BASE_LOCAL} to stay within the 64-char RFC 5321 limit.`
    );
  }

  // Compact: strip hyphens from UUID (36→32 chars) and date (10→8 chars)
  const regIdCompact = registrationId.replace(/-/g, "");
  const dayDateCompact = dayDate ? dayDate.replace(/-/g, "") : undefined;

  return dayDate
    ? `${baseLocal}+${regIdCompact}-${dayDateCompact}-${signature}@${domain}`
    : `${baseLocal}+${regIdCompact}-${signature}@${domain}`;
}

export interface VerifiedRsvpAddress {
  registrationId: string;
  dayDate: string | null;
}

export async function verifySignedRsvpAddress(
  emailAddress: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org"
): Promise<string | null> {
  const result = await verifySignedRsvpAddressFull(emailAddress, secret, baseEmail);
  return result ? result.registrationId : null;
}

/** Reconstruct a UUID string (8-4-4-4-12) from 32 hex chars. */
function expandUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reconstruct a YYYY-MM-DD string from 8 digit chars. */
function expandDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export async function verifySignedRsvpAddressFull(
  emailAddress: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org"
): Promise<VerifiedRsvpAddress | null> {
  const [baseLocal, baseDomain] = baseEmail.split("@");
  if (!baseDomain) return null;

  const parts = emailAddress.split("@");
  if (parts.length !== 2) return null;
  if (parts[1].toLowerCase() !== baseDomain.toLowerCase()) return null;

  // Escape only the base local part (before any +)
  const escapedLocal = baseLocal.split("+")[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ── Compact formats ────────────────────────────────────────────────────────

  // Per-day: [base]+[hex32]-[YYYYMMDD]-[hex8]
  const compactPerDayRegex = new RegExp(
    `^${escapedLocal}\\+([a-f0-9]{32})-(\\d{8})-([a-f0-9]{8})$`,
    "i"
  );
  const compactPerDayMatch = parts[0].match(compactPerDayRegex);
  if (compactPerDayMatch) {
    const registrationId = expandUuid(compactPerDayMatch[1].toLowerCase());
    const dayDate = expandDate(compactPerDayMatch[2]);
    const signature = compactPerDayMatch[3];
    const expectedHmac = await hmacSha256Hex(secret, `${registrationId}-${dayDate}`);
    if (expectedHmac.substring(0, 8).toLowerCase() === signature.toLowerCase()) {
      return { registrationId, dayDate };
    }
  }

  // Single: [base]+[hex32]-[hex8]
  const compactSingleRegex = new RegExp(
    `^${escapedLocal}\\+([a-f0-9]{32})-([a-f0-9]{8})$`,
    "i"
  );
  const compactSingleMatch = parts[0].match(compactSingleRegex);
  if (compactSingleMatch) {
    const registrationId = expandUuid(compactSingleMatch[1].toLowerCase());
    const signature = compactSingleMatch[2];
    const expectedHmac = await hmacSha256Hex(secret, registrationId);
    if (expectedHmac.substring(0, 8).toLowerCase() === signature.toLowerCase()) {
      return { registrationId, dayDate: null };
    }
  }

  return null;
}
