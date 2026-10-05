/** Existing versioned AES-GCM envelope, shared by purpose-specific protected capabilities. */
const encoder = new TextEncoder();
export function encodeBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
export function decodeBase64Url(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoded value");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function key(secret: string, purpose: string) {
  if (secret.length < 32) throw new Error("Capability encryption is unavailable");
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`${purpose}\0${secret}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealValue(value: string, secret: string, purpose: string, additionalData?: string) {
  const plaintext = encoder.encode(value);
  if (plaintext.byteLength > 16384) throw new Error("Protected capability exceeds its size limit");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, ...(additionalData ? { additionalData: encoder.encode(additionalData) } : {}) },
    await key(secret, purpose),
    plaintext,
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}
export async function openValue(value: string, secret: string, purpose: string, additionalData?: string) {
  if (value.length > 24000) throw new Error("Protected capability exceeds its size limit");
  const [version, iv, ciphertext, ...rest] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext || rest.length || decodeBase64Url(iv).byteLength !== 12)
    throw new Error("Invalid protected capability");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64Url(iv),
      ...(additionalData ? { additionalData: encoder.encode(additionalData) } : {}),
    },
    await key(secret, purpose),
    decodeBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
