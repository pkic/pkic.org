import { hmacSha256Hex } from "../utils/crypto";

export async function generateSignedBounceAddress(
  outboxId: string,
  secret: string,
  baseEmail: string = "bounces@mail.pkic.org",
): Promise<string> {
  const hmac = await hmacSha256Hex(secret, outboxId);
  const signature = hmac.substring(0, 10);

  const [localPart, domain] = baseEmail.split("@");
  if (!domain) throw new Error("Invalid base email");
  const baseLocal = localPart.split("+")[0];

  // sub-address appended: +{UUID-36}-{sig10} = 1+36+1+10 = 48 chars
  // RFC 5321 local-part limit is 64 chars, so base must be ≤ 16
  const MAX_BASE_LOCAL = 16;
  if (baseLocal.length > MAX_BASE_LOCAL) {
    throw new Error(
      `Bounce base email local part "${baseLocal}" is ${baseLocal.length} chars; ` +
        `max allowed is ${MAX_BASE_LOCAL} to stay within the 64-char RFC 5321 limit.`,
    );
  }

  return `${baseLocal}+${outboxId}-${signature}@${domain}`;
}

export async function verifySignedBounceAddress(
  emailAddress: string,
  secret: string,
  baseEmail: string = "bounces@mail.pkic.org",
): Promise<string | null> {
  const [baseLocal, baseDomain] = baseEmail.split("@");
  if (!baseDomain) return null;

  const parts = emailAddress.split("@");
  if (parts.length !== 2) return null;
  if (parts[1].toLowerCase() !== baseDomain.toLowerCase()) return null;

  const escapedLocal = baseLocal.split("+")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `^${escapedLocal}\\+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([a-f0-9]{10})$`,
    "i",
  );
  const match = parts[0].match(regex);
  if (!match) return null;

  const outboxId = match[1];
  const signature = match[2];

  const expectedHmac = await hmacSha256Hex(secret, outboxId);
  if (expectedHmac.substring(0, 10).toLowerCase() === signature.toLowerCase()) {
    return outboxId;
  }

  return null;
}
