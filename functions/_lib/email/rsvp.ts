import { hmacSha256Hex } from "../utils/crypto";

/**
 * Returns a signed email address for RSVP and bounce tracking using sub-addressing.
 * Format: rsvp+[registration_id]-[signature]@mail.pkic.org
 */
export async function generateSignedRsvpAddress(
  registrationId: string,
  secret: string,
  domain: string = "mail.pkic.org"
): Promise<string> {
  const hmac = await hmacSha256Hex(secret, registrationId);
  const signature = hmac.substring(0, 10);
  return `rsvp+${registrationId}-${signature}@${domain}`;
}

export async function verifySignedRsvpAddress(
  emailAddress: string,
  secret: string
): Promise<string | null> {
  const parts = emailAddress.split("@");
  if (parts.length !== 2) return null;
  
  const match = parts[0].match(/^rsvp\+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([a-f0-9]{10})$/i);
  if (!match) return null;

  const registrationId = match[1];
  const signature = match[2];

  const expectedHmac = await hmacSha256Hex(secret, registrationId);
  if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
    return registrationId;
  }

  return null;
}
