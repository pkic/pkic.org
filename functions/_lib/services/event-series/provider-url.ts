import { httpsCapabilityUrlSchema } from "../../../../assets/shared/schemas/urls";
import { AppError } from "../../errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new AppError(503, "MEETING_PROVIDER_KEY_UNAVAILABLE", "Meeting-provider encryption is not configured");
  }
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`pkic-meeting-provider\0${secret}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealProviderJoinUrl(url: string, secret: string): Promise<string> {
  const validatedUrl = httpsCapabilityUrlSchema.parse(url);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    encoder.encode(validatedUrl),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function openProviderJoinUrl(value: string, secret: string): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) {
    throw new AppError(500, "MEETING_PROVIDER_URL_INVALID", "Stored meeting-provider URL is invalid");
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      await encryptionKey(secret),
      fromBase64Url(ciphertext),
    );
    return httpsCapabilityUrlSchema.parse(decoder.decode(plaintext));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, "MEETING_PROVIDER_URL_INVALID", "Stored meeting-provider URL cannot be decrypted");
  }
}
