import { hmacSha256Hex } from "../utils/crypto";

/**
 * Returns a signed email address for RSVP and bounce tracking using sub-addressing.
 * Format (single-day):  [baseLocal]+[registration_id]-[signature]@[domain]
 * Format (per-day):     [baseLocal]+[registration_id]-[dayDate]-[signature]@[domain]
 *
 * Including the day date in the address lets implicit email replies (Outlook/Apple Mail
 * subject-line declines without an ICS attachment) be mapped back to the correct day.
 */
export async function generateSignedRsvpAddress(
  registrationId: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org",
  dayDate?: string,
): Promise<string> {
  const payload = dayDate ? `${registrationId}-${dayDate}` : registrationId;
  const hmac = await hmacSha256Hex(secret, payload);
  const signature = hmac.substring(0, 10);

  const [localPart, domain] = baseEmail.split("@");
  if (!domain) throw new Error("Invalid base email");
  // Strip any existing sub-address (e.g. if baseEmail is already a signed address)
  const baseLocal = localPart.split("+")[0];

  return dayDate
    ? `${baseLocal}+${registrationId}-${dayDate}-${signature}@${domain}`
    : `${baseLocal}+${registrationId}-${signature}@${domain}`;
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

  const escapedLocal = baseLocal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uuidPattern = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

  // Try per-day format first: registrationId-YYYY-MM-DD-signature
  const perDayRegex = new RegExp(
    `^${escapedLocal}\\+(${uuidPattern})-(\\d{4}-\\d{2}-\\d{2})-([a-f0-9]{10})$`,
    "i"
  );
  const perDayMatch = parts[0].match(perDayRegex);
  if (perDayMatch) {
    const registrationId = perDayMatch[1];
    const dayDate = perDayMatch[2];
    const signature = perDayMatch[3];
    const expectedHmac = await hmacSha256Hex(secret, `${registrationId}-${dayDate}`);
    if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
      return { registrationId, dayDate };
    }
  }

  // Fall back to registration-only format: registrationId-signature
  const singleRegex = new RegExp(
    `^${escapedLocal}\\+(${uuidPattern})-([a-f0-9]{10})$`,
    "i"
  );
  const singleMatch = parts[0].match(singleRegex);
  if (singleMatch) {
    const registrationId = singleMatch[1];
    const signature = singleMatch[2];
    const expectedHmac = await hmacSha256Hex(secret, registrationId);
    if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
      return { registrationId, dayDate: null };
    }
  }

  return null;
}
