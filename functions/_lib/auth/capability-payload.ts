import type { z } from "zod";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Invalid base64url input");
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCapabilityPayload(payload: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
}

export function decodeCapabilityPayload<T>(resourceId: string, schema: z.ZodType<T>): T | null {
  try {
    return schema.parse(JSON.parse(decoder.decode(base64UrlToBytes(resourceId))));
  } catch {
    return null;
  }
}
