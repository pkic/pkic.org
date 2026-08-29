import { first, run } from "../db/queries";
import { AppError } from "../errors";
import { sha256Hex } from "../utils/crypto";
import type { DatabaseLike, Env } from "../types";
import {
  DEFAULT_TTL_SECONDS,
  capabilityPurposeCode,
  capabilityPurposeFromCode,
  decodeCapabilityText,
  encodeCapabilityText,
  isStatelessCapabilityPurpose,
  newCapabilityLinkSecret,
  parseCapabilityToken,
  signCapabilityToken,
  signStatelessCapabilityToken,
  statelessCapabilityLinkSecret,
  verifyCapabilityToken,
  verifyStatelessCapabilityToken,
} from "./capability-token";
import type { CapabilityPurpose, CapabilityVerifyResult } from "./capability-token";
import {
  activeEffectiveInviteExpirySql,
  effectiveInviteExpirySql,
  effectiveMeetingGuestInviteExpirySql,
  effectiveProposalSpeakerInviteExpirySql,
} from "../invite-validity";
import { normalizeEmail } from "../validation";

const encoder = new TextEncoder();

const QUEUED_TOKEN_PREFIX = "pkcq1_";
const AUTHORIZED_MARKERS_FIELD = "__authorizedCapabilityMarkers";

interface QueuedCapabilityDescriptor {
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds: number;
  /** SHA-256 fingerprint of the link secret at enqueue time; never the secret itself. */
  linkSecretFingerprint?: string;
  /** Optional absolute delivery deadline for request-time-bounded links. */
  expiresAtSeconds?: number;
}

interface AuthorizedQueuedMarker {
  marker: string;
  /** Canonical recipient identity required for mailbox-bound capabilities. */
  recipientNormalizedEmail?: string;
}

export {
  newCapabilityLinkSecret,
  signCapabilityToken,
  signStatelessCapabilityToken,
  verifyCapabilityToken,
  verifyStatelessCapabilityToken,
};
export type {
  CapabilityPurpose,
  CapabilityVerifyResult,
  EmailAuthCapabilityPurpose,
  StatelessCapabilityPurpose,
} from "./capability-token";

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

export async function signedOrQueuedCapability(payload: {
  signingSecret?: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
  expiresAtSeconds?: number;
}): Promise<string> {
  return payload.signingSecret
    ? signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: payload.linkSecret,
        purpose: payload.purpose,
        resourceId: payload.resourceId,
        ttlSeconds: payload.ttlSeconds,
      })
    : queuedCapabilityTokenBoundToSecret(
        payload.purpose,
        payload.resourceId,
        payload.linkSecret,
        payload.ttlSeconds,
        payload.expiresAtSeconds,
      );
}

function parseQueuedDescriptor(marker: string): QueuedCapabilityDescriptor | null {
  const unfoldedMarker = marker.replace(/\r?\n[ \t]/g, "");
  if (!unfoldedMarker.startsWith(QUEUED_TOKEN_PREFIX)) return null;
  try {
    const values = decodeCapabilityText(unfoldedMarker.slice(QUEUED_TOKEN_PREFIX.length)).split("|");
    if (values.length < 3 || values.length > 5) return null;
    const [purposeCode, resourceId, ttlSecondsRaw, linkSecretFingerprint, expiresAtSecondsRaw] = values;
    const purpose = capabilityPurposeFromCode(purposeCode);
    const ttlSeconds = Number(ttlSecondsRaw);
    const expiresAtSeconds = expiresAtSecondsRaw === undefined ? undefined : Number(expiresAtSecondsRaw);
    if (
      !purpose ||
      !resourceId ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds <= 0 ||
      (linkSecretFingerprint !== undefined &&
        linkSecretFingerprint !== "" &&
        !/^[a-f0-9]{64}$/i.test(linkSecretFingerprint)) ||
      (expiresAtSeconds !== undefined && (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0))
    ) {
      return null;
    }
    return {
      purpose,
      resourceId,
      ttlSeconds,
      linkSecretFingerprint: linkSecretFingerprint || undefined,
      expiresAtSeconds,
    };
  } catch {
    return null;
  }
}

export function queuedCapabilityToken(
  purpose: CapabilityPurpose,
  resourceId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  linkSecretFingerprint?: string,
  expiresAtSeconds?: number,
): string {
  if (purpose === "speaker_manage" && linkSecretFingerprint === undefined) {
    throw new Error("Queued speaker capabilities must be bound to the current link secret");
  }
  if (linkSecretFingerprint !== undefined && !/^[a-f0-9]{64}$/i.test(linkSecretFingerprint)) {
    throw new Error("Queued capability secret fingerprint is invalid");
  }
  if (expiresAtSeconds !== undefined && (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0)) {
    throw new Error("Queued capability expiry is invalid");
  }
  const values = [capabilityPurposeCode(purpose), resourceId, String(Math.max(1, Math.floor(ttlSeconds)))];
  if (linkSecretFingerprint !== undefined || expiresAtSeconds !== undefined) values.push(linkSecretFingerprint ?? "");
  if (expiresAtSeconds !== undefined) values.push(String(expiresAtSeconds));
  return `${QUEUED_TOKEN_PREFIX}${encodeCapabilityText(values.join("|"))}`;
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
  expiresAtSeconds?: number,
): Promise<string> {
  return queuedCapabilityToken(purpose, resourceId, ttlSeconds, await sha256Hex(linkSecret), expiresAtSeconds);
}

function capabilitySecretQuery(purpose: CapabilityPurpose, allowInactiveInvite = false): string {
  switch (purpose) {
    case "registration_manage":
      return "SELECT manage_link_secret AS link_secret FROM registrations WHERE id = ?";
    case "registration_confirm":
      return "SELECT confirmation_link_secret AS link_secret FROM registrations WHERE id = ?";
    case "invite":
      return allowInactiveInvite
        ? "SELECT i.link_secret FROM invites i WHERE i.id = ?"
        : `SELECT i.link_secret
           FROM invites i
           JOIN events e ON e.id = i.event_id
           WHERE i.id = ? AND i.status = 'sent'
             AND ${activeEffectiveInviteExpirySql(
               effectiveInviteExpirySql("i", "e"),
               "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
             )}`;
    case "proposal_manage":
      return "SELECT manage_link_secret AS link_secret FROM session_proposals WHERE id = ?";
    case "speaker_manage":
      return "SELECT manage_link_secret AS link_secret FROM proposal_speakers WHERE id = ?";
    case "meeting_guest_verify": {
      const effectiveExpiry = effectiveMeetingGuestInviteExpirySql();
      return `SELECT guest.invitation_secret AS link_secret
                FROM event_occurrence_guests guest
                JOIN event_series series ON series.id = guest.series_id
                JOIN events event ON event.id = series.event_id
           LEFT JOIN event_occurrences guest_occurrence
                  ON guest_occurrence.id = guest.occurrence_id
                 AND guest_occurrence.series_id = guest.series_id
               WHERE guest.id = ?
                 AND guest.revoked_at IS NULL
                 AND ${activeEffectiveInviteExpirySql(effectiveExpiry, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")}`;
    }
    case "member_join_verify":
    case "member_join_apply":
    case "user_sign_in":
    case "sponsor_sign_in":
      throw new Error("Stateless capabilities do not have a database secret query");
  }
}

async function loadCapabilityLinkSecret(
  db: DatabaseLike,
  purpose: CapabilityPurpose,
  resourceId: string,
  allowInactiveInvite = false,
  expectedRecipientNormalizedEmail?: string,
): Promise<string | null> {
  if (isStatelessCapabilityPurpose(purpose)) return statelessCapabilityLinkSecret(purpose);
  const recipientBoundSpeaker = purpose === "speaker_manage" && expectedRecipientNormalizedEmail !== undefined;
  const row = await first<{ link_secret: string | null }>(
    db,
    recipientBoundSpeaker
      ? `SELECT ps.manage_link_secret AS link_secret
           FROM proposal_speakers ps
           JOIN users u ON u.id = ps.user_id
           JOIN session_proposals sp ON sp.id = ps.proposal_id
           JOIN events e ON e.id = sp.event_id
          WHERE ps.id = ? AND u.normalized_email = ?
            AND (
              ps.status = 'confirmed'
              OR (ps.status = 'invited' AND
                ${activeEffectiveInviteExpirySql(
                  effectiveProposalSpeakerInviteExpirySql("ps", "e"),
                  "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                )}
              )
            )`
      : capabilitySecretQuery(purpose, allowInactiveInvite),
    recipientBoundSpeaker ? [resourceId, expectedRecipientNormalizedEmail] : [resourceId],
  );
  return row?.link_secret ?? null;
}

async function loadOrCreateCapabilityLinkSecret(
  db: DatabaseLike,
  purpose: CapabilityPurpose,
  resourceId: string,
  expectedRecipientNormalizedEmail?: string,
): Promise<string | null> {
  if (isStatelessCapabilityPurpose(purpose)) return statelessCapabilityLinkSecret(purpose);
  const existing = await loadCapabilityLinkSecret(db, purpose, resourceId, false, expectedRecipientNormalizedEmail);
  if (existing || purpose !== "speaker_manage") return existing;

  // Legacy proposal_speakers rows may have a null secret. Generate it with
  // Workers Web Crypto instead of relying on database-side randomness. The
  // conditional update makes concurrent issuers converge on one stored value.
  await run(
    db,
    `UPDATE proposal_speakers
        SET manage_link_secret = ?
      WHERE id = ? AND manage_link_secret IS NULL
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM users u
             WHERE u.id = proposal_speakers.user_id AND u.normalized_email = ?
          )
        )`,
    [
      newCapabilityLinkSecret(),
      resourceId,
      expectedRecipientNormalizedEmail ?? null,
      expectedRecipientNormalizedEmail ?? null,
    ],
  );
  return loadCapabilityLinkSecret(db, purpose, resourceId, false, expectedRecipientNormalizedEmail);
}

export async function verifyDatabaseCapability(payload: {
  db: DatabaseLike;
  signingSecret: string;
  purpose: CapabilityPurpose;
  token: string;
  allowInactiveInvite?: boolean;
}): Promise<CapabilityVerifyResult> {
  const parsed = parseCapabilityToken(payload.token, payload.purpose);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (Math.floor(Date.now() / 1000) >= parsed.expiresAt) return { ok: false, reason: "expired" };
  const linkSecret = await loadCapabilityLinkSecret(
    payload.db,
    payload.purpose,
    parsed.resourceId,
    payload.allowInactiveInvite === true,
  );
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
  expectedRecipientNormalizedEmail?: string;
}): Promise<string> {
  const linkSecret = await loadOrCreateCapabilityLinkSecret(
    payload.db,
    payload.purpose,
    payload.resourceId,
    payload.expectedRecipientNormalizedEmail,
  );
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
  context?: { recipientEmail?: string },
): Record<string, unknown> {
  const authorizedPayload = { ...payload };
  delete authorizedPayload[AUTHORIZED_MARKERS_FIELD];
  const markers = new Set<string>();
  for (const value of serverAuthoredValues) collectQueuedMarkers(value, markers);
  if (markers.size > 0) {
    authorizedPayload[AUTHORIZED_MARKERS_FIELD] = [...markers].map((marker): string | AuthorizedQueuedMarker => {
      const descriptor = parseQueuedDescriptor(marker);
      if (descriptor?.purpose !== "speaker_manage") return marker;
      return {
        marker,
        ...(context?.recipientEmail ? { recipientNormalizedEmail: normalizeEmail(context.recipientEmail) } : {}),
      };
    });
  }
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
  authorizedMarkers: Map<string, AuthorizedQueuedMarker>,
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
        const authorization = authorizedMarkers.get(canonicalMarker);
        if (descriptor.purpose === "speaker_manage" && !authorization?.recipientNormalizedEmail) {
          throw new AppError(410, "CAPABILITY_RESOURCE_STALE", "Queued speaker capability is not recipient-bound");
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const remainingTtlSeconds = descriptor.expiresAtSeconds
          ? descriptor.expiresAtSeconds - nowSeconds
          : descriptor.ttlSeconds;
        if (remainingTtlSeconds <= 0) {
          throw new AppError(410, "CAPABILITY_RESOURCE_STALE", "Queued capability delivery deadline expired");
        }
        const token = await issueDatabaseCapability({
          db,
          signingSecret,
          purpose: descriptor.purpose,
          resourceId: descriptor.resourceId,
          ttlSeconds: Math.min(descriptor.ttlSeconds, remainingTtlSeconds),
          expectedLinkSecretFingerprint: descriptor.linkSecretFingerprint,
          expectedRecipientNormalizedEmail:
            descriptor.purpose === "speaker_manage" ? authorization?.recipientNormalizedEmail : undefined,
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
  authorizedMarkers: Map<string, AuthorizedQueuedMarker>,
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
  const authorizedMarkers = new Map<string, AuthorizedQueuedMarker>();
  if (Array.isArray(rawAuthorizedMarkers)) {
    for (const rawMarker of rawAuthorizedMarkers) {
      if (typeof rawMarker === "string") {
        const marker = canonicalQueuedMarker(rawMarker);
        authorizedMarkers.set(marker, { marker });
        continue;
      }
      if (!rawMarker || typeof rawMarker !== "object") continue;
      const candidate = rawMarker as Record<string, unknown>;
      if (typeof candidate.marker !== "string") continue;
      const marker = canonicalQueuedMarker(candidate.marker);
      authorizedMarkers.set(marker, {
        marker,
        ...(typeof candidate.recipientNormalizedEmail === "string"
          ? { recipientNormalizedEmail: normalizeEmail(candidate.recipientNormalizedEmail) }
          : {}),
      });
    }
  }
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
