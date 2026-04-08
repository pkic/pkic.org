import { hmacSha256Hex } from "../utils/crypto";

/**
 * Returns a signed email address for RSVP and bounce tracking using sub-addressing.
 * Format: [baseLocal]+[registration_id]-[signature]@[domain]
 */
export async function generateSignedRsvpAddress(
  registrationId: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org"
): Promise<string> {
  const hmac = await hmacSha256Hex(secret, registrationId);
  const signature = hmac.substring(0, 10);
  
  const [localPart, domain] = baseEmail.split("@");
  if (!domain) throw new Error("Invalid base email");
  
  return `${localPart}+${registrationId}-${signature}@${domain}`;
}

export async function verifySignedRsvpAddress(
  emailAddress: string,
  secret: string,
  baseEmail: string = "rsvp@mail.pkic.org"
): Promise<string | null> {
  const [baseLocal, baseDomain] = baseEmail.split("@");
  if (!baseDomain) return null;

  const parts = emailAddress.split("@");
  if (parts.length !== 2) return null;
  if (parts[1].toLowerCase() !== baseDomain.toLowerCase()) return null;
  
  const escapedLocal = baseLocal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escapedLocal}\\+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([a-f0-9]{10})$`, "i");
  const match = parts[0].match(regex);
  if (!match) return null;

  const registrationId = match[1];
  const signature = match[2];

  const expectedHmac = await hmacSha256Hex(secret, registrationId);
  if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
    return registrationId;
  }

  return null;
}
