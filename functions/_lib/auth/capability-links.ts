import { first, run } from "../db/queries";
import { AppError } from "../errors";
import { randomToken, sha256Hex } from "../utils/crypto";
import type { DatabaseLike, Env } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TOKEN_PREFIX = "pkc1_";
const QUEUED_TOKEN_PREFIX = "pkcq1_";
const AUTHORIZED_MARKERS_FIELD = "__authorizedCapabilityMarkers";
const SIGNING_DOMAIN = "pkic-public-capability:v1";
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 512;

export type CapabilityPurpose =
  | "registration_manage"
  | "registration_confirm"
  | "invite"
  | "proposal_manage"
  | "speaker_manage"
  | "meeting_guest_verify";

const purposeCodes: Record<CapabilityPurpose, string> = {
  registration_manage: "rm",
  registration_confirm: "rc",
  invite: "iv",
  proposal_manage: "pm",
  speaker_manage: "sm",
  meeting_guest_verify: "mgv",
};

const purposesByCode = Object.fromEntries(
  Object.entries(purposeCodes).map(([purpose, code]) => [code, purpose]),
) as Record<string, CapabilityPurpose>;

interface ParsedCapabilityToken {
  purpose: CapabilityPurpose;
  resourceId: string;
  expiresAt: number;
  encodedPayload: string;
  signature: string;
}

interface QueuedCapabilityDescriptor {
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds: number;
  /** SHA-256 fingerprint of the link secret at enqueue time; never the secret itself. */
  linkSecretFingerprint?: string;
}

export type CapabilityVerifyResult =
  { ok: true; resourceId: string; expiresAt: number } | { ok: false; reason: "invalid" | "expired" };

export function omitCapabilitySecrets<T extends object>(
  record: T,
): Omit<T, "confirmation_link_secret" | "manage_link_secret" | "link_secret" | "invitation_secret"> {
  const sanitized = { ...record } as Record<string, unknown>;
  delete sanitized.confirmation_link_secret;
  delete sanitized.manage_link_secret;
  delete sanitized.link_secret;
  delete sanitized.invitation_secret;
  return sanitized as Omit<T, "confirmation_link_secret" | "manage_link_secret" | "link_secret" | "invitation_secret">;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Invalid base64url input");
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeText(input: string): string {
  return bytesToBase64Url(encoder.encode(input));
}

function decodeText(input: string): string {
  return decoder.decode(base64UrlToBytes(input));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function signatureInput(purpose: CapabilityPurpose, encodedPayload: string, linkSecret: string): ArrayBuffer {
  return encoder.encode(`${SIGNING_DOMAIN}\0${purpose}\0${encodedPayload}\0${linkSecret}`).buffer as ArrayBuffer;
}

function parseToken(token: string, expectedPurpose: CapabilityPurpose): ParsedCapabilityToken | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.slice(TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  try {
    const values = decodeText(encodedPayload).split("|");
    if (values.length !== 3) return null;
    const [purposeCode, resourceId, expiresAtRaw] = values;
    const purpose = purposesByCode[purposeCode];
    const expiresAt = Number(expiresAtRaw);
    if (
      purpose !== expectedPurpose ||
      !resourceId ||
      resourceId.length > 128 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= 0
    ) {
      return null;
    }
    return { purpose, resourceId, expiresAt, encodedPayload, signature };
  } catch {
    return null;
  }
}

export function newCapabilityLinkSecret(): string {
  return randomToken(32);
}

export async function signCapabilityToken(payload: {
  signingSecret: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): Promise<string> {
  const ttlSeconds = Math.max(1, Math.floor(payload.ttlSeconds ?? DEFAULT_TTL_SECONDS));
  const expiresAt = Math.floor(payload.nowSeconds ?? Date.now() / 1000) + ttlSeconds;
  const encodedPayload = encodeText(`${purposeCodes[payload.purpose]}|${payload.resourceId}|${expiresAt}`);
  const key = await importHmacKey(payload.signingSecret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    signatureInput(payload.purpose, encodedPayload, payload.linkSecret),
  );
  return `${TOKEN_PREFIX}${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function signedOrQueuedCapability(payload: {
  signingSecret?: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
}): Promise<string> {
  return payload.signingSecret
    ? signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: payload.linkSecret,
        purpose: payload.purpose,
        resourceId: payload.resourceId,
        ttlSeconds: payload.ttlSeconds,
      })
    : queuedCapabilityToken(payload.purpose, payload.resourceId, payload.ttlSeconds);
}

export async function verifyCapabilityToken(payload: {
  signingSecret: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  token: string;
  nowSeconds?: number;
}): Promise<CapabilityVerifyResult> {
  const parsed = parseToken(payload.token, payload.purpose);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (Math.floor(payload.nowSeconds ?? Date.now() / 1000) >= parsed.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  try {
    const signature = base64UrlToBytes(parsed.signature);
    const key = await importHmacKey(payload.signingSecret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature.buffer as ArrayBuffer,
      signatureInput(parsed.purpose, parsed.encodedPayload, payload.linkSecret),
    );
    return valid
      ? { ok: true, resourceId: parsed.resourceId, expiresAt: parsed.expiresAt }
      : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function parseQueuedDescriptor(marker: string): QueuedCapabilityDescriptor | null {
  const unfoldedMarker = marker.replace(/\r?\n[ \t]/g, "");
  if (!unfoldedMarker.startsWith(QUEUED_TOKEN_PREFIX)) return null;
  try {
    const values = decodeText(unfoldedMarker.slice(QUEUED_TOKEN_PREFIX.length)).split("|");
    if (values.length !== 3 && values.length !== 4) return null;
    const [purposeCode, resourceId, ttlSecondsRaw, linkSecretFingerprint] = values;
    const purpose = purposesByCode[purposeCode];
    const ttlSeconds = Number(ttlSecondsRaw);
    if (
      !purpose ||
      !resourceId ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds <= 0 ||
      (linkSecretFingerprint !== undefined && !/^[a-f0-9]{64}$/i.test(linkSecretFingerprint))
    ) {
      return null;
    }
    return { purpose, resourceId, ttlSeconds, linkSecretFingerprint };
  } catch {
    return null;
  }
}

export function queuedCapabilityToken(
  purpose: CapabilityPurpose,
  resourceId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  linkSecretFingerprint?: string,
): string {
  if (linkSecretFingerprint !== undefined && !/^[a-f0-9]{64}$/i.test(linkSecretFingerprint)) {
    throw new Error("Queued capability secret fingerprint is invalid");
  }
  return `${QUEUED_TOKEN_PREFIX}${encodeText(
    [purposeCodes[purpose], resourceId, String(Math.max(1, Math.floor(ttlSeconds))), linkSecretFingerprint]
      .filter((value) => value !== undefined)
      .join("|"),
  )}`;
}

/**
 * Queues a capability that may be delivered only while the resource still has
 * the exact link-secret generation it had when the message was enqueued.
 * The marker contains only a one-way fingerprint, never the raw secret.
 */
export async function queuedCapabilityTokenBoundToSecret(
  purpose: CapabilityPurpose,
  resourceId: string,
  linkSecret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  return queuedCapabilityToken(purpose, resourceId, ttlSeconds, await sha256Hex(linkSecret));
}

function capabilitySecretQuery(purpose: CapabilityPurpose): string {
  switch (purpose) {
    case "registration_manage":
      return "SELECT manage_link_secret AS link_secret FROM registrations WHERE id = ?";
    case "registration_confirm":
      return "SELECT confirmation_link_secret AS link_secret FROM registrations WHERE id = ?";
    case "invite":
      return "SELECT link_secret FROM invites WHERE id = ?";
    case "proposal_manage":
      return "SELECT manage_link_secret AS link_secret FROM session_proposals WHERE id = ?";
    case "speaker_manage":
      return "SELECT manage_link_secret AS link_secret FROM proposal_speakers WHERE id = ?";
    case "meeting_guest_verify":
      return "SELECT invitation_secret AS link_secret FROM event_occurrence_guests WHERE id = ?";
  }
}

async function loadCapabilityLinkSecret(
  db: DatabaseLike,
  purpose: CapabilityPurpose,
  resourceId: string,
): Promise<string | null> {
  const row = await first<{ link_secret: string | null }>(db, capabilitySecretQuery(purpose), [resourceId]);
  return row?.link_secret ?? null;
}

async function loadOrCreateCapabilityLinkSecret(
  db: DatabaseLike,
  purpose: CapabilityPurpose,
  resourceId: string,
): Promise<string | null> {
  const existing = await loadCapabilityLinkSecret(db, purpose, resourceId);
  if (existing || purpose !== "speaker_manage") return existing;

  // Legacy proposal_speakers rows may have a null secret. Generate it with
  // Workers Web Crypto instead of relying on database-side randomness. The
  // conditional update makes concurrent issuers converge on one stored value.
  await run(db, "UPDATE proposal_speakers SET manage_link_secret = ? WHERE id = ? AND manage_link_secret IS NULL", [
    newCapabilityLinkSecret(),
    resourceId,
  ]);
  return loadCapabilityLinkSecret(db, purpose, resourceId);
}

export async function verifyDatabaseCapability(payload: {
  db: DatabaseLike;
  signingSecret: string;
  purpose: CapabilityPurpose;
  token: string;
}): Promise<CapabilityVerifyResult> {
  const parsed = parseToken(payload.token, payload.purpose);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (Math.floor(Date.now() / 1000) >= parsed.expiresAt) return { ok: false, reason: "expired" };
  const linkSecret = await loadCapabilityLinkSecret(payload.db, payload.purpose, parsed.resourceId);
  if (!linkSecret) return { ok: false, reason: "invalid" };
  return verifyCapabilityToken({
    signingSecret: payload.signingSecret,
    linkSecret,
    purpose: payload.purpose,
    token: payload.token,
  });
}

export async function issueDatabaseCapability(payload: {
  db: DatabaseLike;
  signingSecret: string;
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
  expectedLinkSecretFingerprint?: string;
}): Promise<string> {
  const linkSecret = await loadOrCreateCapabilityLinkSecret(payload.db, payload.purpose, payload.resourceId);
  if (!linkSecret) throw new AppError(404, "CAPABILITY_RESOURCE_NOT_FOUND", "Capability resource not found");
  if (
    payload.expectedLinkSecretFingerprint !== undefined &&
    (await sha256Hex(linkSecret)) !== payload.expectedLinkSecretFingerprint
  ) {
    throw new AppError(410, "CAPABILITY_RESOURCE_STALE", "Queued capability no longer matches the resource state");
  }
  return signCapabilityToken({ ...payload, linkSecret });
}

// Calendar generators fold long RFC 5545 property lines using CRLF + space,
// which can split an otherwise contiguous queued marker.
const queuedMarkerPattern = /pkcq1_(?:[A-Za-z0-9_-]|\r?\n[ \t])+/g;

function canonicalQueuedMarker(marker: string): string {
  return marker.replace(/\r?\n[ \t]/g, "");
}

function collectQueuedMarkers(value: unknown, markers: Set<string>): void {
  if (typeof value === "string") {
    for (const marker of value.match(queuedMarkerPattern) ?? []) {
      markers.add(canonicalQueuedMarker(marker));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectQueuedMarkers(item, markers);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectQueuedMarkers(item, markers);
  }
}

/** Persists the exact server-authored queued markers that may be materialized at delivery time. */
export function authorizeQueuedCapabilityLinks(
  payload: Record<string, unknown>,
  serverAuthoredValues: unknown[],
): Record<string, unknown> {
  const authorizedPayload = { ...payload };
  delete authorizedPayload[AUTHORIZED_MARKERS_FIELD];
  const markers = new Set<string>();
  for (const value of serverAuthoredValues) collectQueuedMarkers(value, markers);
  if (markers.size > 0) authorizedPayload[AUTHORIZED_MARKERS_FIELD] = [...markers];
  return authorizedPayload;
}

function foldCalendarToken(value: string, markerIndex: number, token: string): string {
  const lineStart = value.lastIndexOf("\n", markerIndex - 1) + 1;
  const prefixBytes = encoder.encode(value.slice(lineStart, markerIndex)).length;
  const firstChunkLength = Math.max(1, 75 - prefixBytes);
  const chunks = [token.slice(0, firstChunkLength)];
  for (let offset = firstChunkLength; offset < token.length; offset += 74) {
    chunks.push(token.slice(offset, offset + 74));
  }
  return chunks.join("\r\n ");
}

function replaceQueuedMarker(value: string, marker: string, token: string): string {
  let result = value;
  let searchFrom = 0;
  while (true) {
    const markerIndex = result.indexOf(marker, searchFrom);
    if (markerIndex < 0) return result;
    const replacement = marker.includes("\n") ? foldCalendarToken(result, markerIndex, token) : token;
    result = `${result.slice(0, markerIndex)}${replacement}${result.slice(markerIndex + marker.length)}`;
    searchFrom = markerIndex + replacement.length;
  }
}

async function materializeString(
  db: DatabaseLike,
  signingSecret: string,
  value: string,
  cache: Map<string, string>,
  authorizedMarkers: Set<string>,
): Promise<string> {
  const markers = Array.from(new Set(value.match(queuedMarkerPattern) ?? [])).filter((marker) =>
    authorizedMarkers.has(canonicalQueuedMarker(marker)),
  );
  if (markers.length === 0) return value;

  await Promise.all(
    markers.map(async (marker) => {
      const canonicalMarker = canonicalQueuedMarker(marker);
      if (cache.has(canonicalMarker)) return;
      const descriptor = parseQueuedDescriptor(marker);
      if (!descriptor) throw new AppError(500, "CAPABILITY_DESCRIPTOR_INVALID", "Queued capability is invalid");
      try {
        const token = await issueDatabaseCapability({
          db,
          signingSecret,
          purpose: descriptor.purpose,
          resourceId: descriptor.resourceId,
          ttlSeconds: descriptor.ttlSeconds,
          expectedLinkSecretFingerprint: descriptor.linkSecretFingerprint,
        });
        cache.set(canonicalMarker, token);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === "CAPABILITY_RESOURCE_NOT_FOUND" || error.code === "CAPABILITY_RESOURCE_STALE")
        ) {
          throw new AppError(410, "CAPABILITY_RESOURCE_STALE", "Queued capability resource is no longer available", {
            purpose: descriptor.purpose,
            resourceId: descriptor.resourceId,
          });
        }
        throw error;
      }
    }),
  );

  return markers.reduce(
    (result, marker) => replaceQueuedMarker(result, marker, cache.get(canonicalQueuedMarker(marker))!),
    value,
  );
}

async function materializeValue(
  db: DatabaseLike,
  signingSecret: string,
  value: unknown,
  cache: Map<string, string>,
  authorizedMarkers: Set<string>,
): Promise<unknown> {
  if (typeof value === "string") return materializeString(db, signingSecret, value, cache, authorizedMarkers);
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => materializeValue(db, signingSecret, item, cache, authorizedMarkers)));
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await materializeValue(db, signingSecret, item, cache, authorizedMarkers),
      ]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export async function materializeQueuedCapabilityLinks(
  db: DatabaseLike,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const deliveryPayload = { ...payload };
  const rawAuthorizedMarkers = deliveryPayload[AUTHORIZED_MARKERS_FIELD];
  delete deliveryPayload[AUTHORIZED_MARKERS_FIELD];
  if (!JSON.stringify(deliveryPayload).includes(QUEUED_TOKEN_PREFIX)) return deliveryPayload;
  const authorizedMarkers = new Set(
    Array.isArray(rawAuthorizedMarkers)
      ? rawAuthorizedMarkers.filter((marker): marker is string => typeof marker === "string").map(canonicalQueuedMarker)
      : [],
  );
  if (authorizedMarkers.size === 0) return deliveryPayload;
  const signingSecret = env.INTERNAL_SIGNING_SECRET;
  if (!signingSecret) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  return (await materializeValue(db, signingSecret, deliveryPayload, new Map(), authorizedMarkers)) as Record<
    string,
    unknown
  >;
}
