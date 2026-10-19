import { z } from "zod";

export const BADGE_CREDENTIAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const BADGE_CREDENTIAL_LENGTH = 16;
const symbols = `[${BADGE_CREDENTIAL_ALPHABET}]`;
const shortCodePattern = new RegExp(
  `^(?:${symbols}{16}|${symbols}{4}(?:-${symbols}{4}){3}|${symbols}{4}(?: ${symbols}{4}){3})$`,
  "i",
);
/** One credential format; normalize its printed separators and case before lookup or replay hashing. */
export const badgeCredentialSchema = z
  .string()
  .max(64)
  .regex(/^[ A-Za-z0-9-]+$/, "Enter the badge code printed below the QR code.")
  .transform((value) => value.trim())
  .refine((value) => shortCodePattern.test(value), "Enter all 16 characters of the badge code.")
  .transform((value) => value.replace(/[- ]/g, "").toUpperCase());

export type BadgeCredential = z.infer<typeof badgeCredentialSchema>;

/** Sixteen independent five-bit symbols provide 80 bits of cryptographic randomness. */
export function generateBadgeCredential(): BadgeCredential {
  const bytes = crypto.getRandomValues(new Uint8Array(BADGE_CREDENTIAL_LENGTH));
  return Array.from(bytes, (value) => BADGE_CREDENTIAL_ALPHABET[value & 31]!).join("");
}

export function formatBadgeCredential(value: string): string {
  const credential = badgeCredentialSchema.parse(value);
  return credential.match(/.{4}/g)!.join("-");
}
