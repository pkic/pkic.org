import { z } from "zod";
import { badgeCredentialSchema } from "./schemas/badge-credential";

const hex = (length: number) => z.string().regex(new RegExp(`^[a-f0-9]{${length}}$`));
export const encryptedBadgeCollectionNameSchema = z
  .object({
    version: z.literal(1),
    salt: hex(32),
    iv: hex(24),
    ciphertext: z
      .string()
      .min(32)
      .max(8192)
      .regex(/^(?:[a-f0-9]{2})+$/),
  })
  .strict();
export type EncryptedBadgeCollectionName = z.infer<typeof encryptedBadgeCollectionNameSchema>;
export interface BadgeCollectionNameBinding {
  eventId: string;
  badgeId: string;
  credentialHash: string;
}
const purpose = "pkic-badge-collection-name-v1";
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const decode = (value: string) => Uint8Array.from(value.match(/.{2}/g)!, (pair) => parseInt(pair, 16));
const associatedData = (binding: BadgeCollectionNameBinding) =>
  encoder.encode(JSON.stringify([purpose, binding.eventId, binding.badgeId, binding.credentialHash]));

/** Stable private content revision without exposing a guessable hash of the person's name. */
export async function badgeCollectionNameDigest(
  credential: string,
  binding: BadgeCollectionNameBinding,
  displayName: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(badgeCredentialSchema.parse(credential)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      JSON.stringify([purpose, "revision", binding.eventId, binding.badgeId, binding.credentialHash, displayName]),
    ),
  );
  return encode(new Uint8Array(bytes));
}

async function deriveKey(credential: string, salt: Uint8Array<ArrayBuffer>, eventId: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(badgeCredentialSchema.parse(credential)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(JSON.stringify([purpose, eventId])) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** The original printed badge secret unlocks one name; cached lookup hashes cannot derive this key. */
export async function encryptBadgeCollectionName(
  credential: string,
  binding: BadgeCollectionNameBinding,
  displayName: string,
): Promise<EncryptedBadgeCollectionName> {
  const plaintext = encoder.encode(displayName);
  if (!plaintext.length || plaintext.length > 4080) throw new Error("Badge name exceeds its size limit");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(binding) },
    await deriveKey(credential, salt, binding.eventId),
    plaintext,
  );
  return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function decryptBadgeCollectionName(
  credential: string,
  binding: BadgeCollectionNameBinding,
  raw: EncryptedBadgeCollectionName,
): Promise<string> {
  const envelope = encryptedBadgeCollectionNameSchema.parse(raw);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(envelope.iv), additionalData: associatedData(binding) },
    await deriveKey(credential, decode(envelope.salt), binding.eventId),
    decode(envelope.ciphertext),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
