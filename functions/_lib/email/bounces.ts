import { hmacSha256Hex } from "../utils/crypto";

export async function generateSignedBounceAddress(
  outboxId: string,
  secret: string,
  domain: string = "mail.pkic.org"
): Promise<string> {
  const hmac = await hmacSha256Hex(secret, outboxId);
  const signature = hmac.substring(0, 10);
  return `bounces+${outboxId}-${signature}@${domain}`;
}

export async function verifySignedBounceAddress(
  emailAddress: string,
  secret: string
): Promise<string | null> {
  const parts = emailAddress.split("@");
  if (parts.length !== 2) return null;
  
  const match = parts[0].match(/^bounces\+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([a-f0-9]{10})$/i);
  if (!match) return null;

  const outboxId = match[1];
  const signature = match[2];

  const expectedHmac = await hmacSha256Hex(secret, outboxId);
  if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
    return outboxId;
  }

  return null;
}
