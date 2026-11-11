import {
  PERSONAL_PROMOTION_RENDERER,
  personalPromotionImageCacheKey,
  personalPromotionRendererIsCurrent,
} from "../../../assets/shared/personal-promotion-image";
import { bytesToBase64 } from "../../../assets/shared/base64";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import { readStoredZipEntries } from "../utils/stored-zip";

/** Durable outbox refusals consumed by the existing badge-render retry owner. */
export const BADGE_ATTACHMENT_WAIT_REASONS = {
  missing: "Required badge attachment is not ready",
  stale: "Required badge attachment is waiting for the current renderer",
} as const;

export interface QueuedBadgeAttachment {
  kind: "r2-badge-image";
  r2Key: string;
  filenameBase: string;
  required?: boolean;
  renderer?: string;
}

/**
 * One format of a speaker's promotion kit. It names the kit, not a file, so a kit
 * rendered again before sending still attaches its current file.
 */
export interface QueuedPromotionKitAttachment {
  kind: "promotion-kit-file";
  eventId: string;
  occurrenceId: string;
  userId: string;
  format: string;
  filenameBase: string;
}

/** A file in storage; the object's own content type names the file type. */
export interface StoredFileAttachment {
  r2Key: string;
  filenameBase: string;
}

export type QueuedEmailAttachment = QueuedBadgeAttachment | QueuedPromotionKitAttachment;

/** A retryable refusal: the outbox tries again while the kit finishes rendering. */
export const PROMOTION_KIT_NOT_READY = "Required promotion file is not ready";

export function slugifyAttachmentPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveAttachmentNamePart(
  firstName: string | undefined,
  lastName: string | undefined,
  fullName: string | undefined,
): string {
  const nameSource = [firstName ?? "", lastName ?? ""].filter(Boolean).join(" ") || (fullName ?? "");
  return nameSource ? slugifyAttachmentPart(nameSource) : "";
}

export function buildBadgeAttachment(payload: {
  badgeCode: string;
  badgeType: "attendee" | "donation";
  firstName?: string;
  lastName?: string;
  name?: string;
}): QueuedBadgeAttachment {
  const filenamePrefix = payload.badgeType === "donation" ? "donation-badge" : "attendee-badge";
  const namePart = resolveAttachmentNamePart(payload.firstName, payload.lastName, payload.name);

  return {
    kind: "r2-badge-image",
    r2Key:
      payload.badgeType === "attendee"
        ? personalPromotionImageCacheKey(payload.badgeCode)
        : `og-badges/${payload.badgeCode}`,
    filenameBase: namePart ? `${filenamePrefix}-${namePart}` : filenamePrefix,
    ...(payload.badgeType === "attendee" ? { required: true, renderer: PERSONAL_PROMOTION_RENDERER } : {}),
  };
}

export function parseQueuedEmailAttachments(payload: Record<string, unknown>): QueuedEmailAttachment[] {
  const rawAttachments = payload.__attachments;
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments.filter((item): item is QueuedEmailAttachment => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.kind === "r2-badge-image") {
      return (
        typeof candidate.r2Key === "string" &&
        candidate.r2Key.length > 0 &&
        typeof candidate.filenameBase === "string" &&
        candidate.filenameBase.length > 0 &&
        (candidate.required === undefined || typeof candidate.required === "boolean") &&
        (candidate.renderer === undefined || typeof candidate.renderer === "string")
      );
    }

    if (candidate.kind === "promotion-kit-file") {
      return ["eventId", "occurrenceId", "userId", "format", "filenameBase"].every(
        (key) => typeof candidate[key] === "string" && (candidate[key] as string).length > 0,
      );
    }

    return false;
  });
}

interface LoadedEmailAttachment {
  filename: string;
  contentType: string;
  base64Content: string;
}

const ZIP_ENTRY_CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png" };
const FILE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Multi-page images are stored as one archive; a speaker receives the images themselves. */
export async function loadStoredFileAttachments(
  bucket: Pick<R2Bucket, "get">,
  attachments: readonly StoredFileAttachment[],
): Promise<LoadedEmailAttachment[]> {
  const loaded: LoadedEmailAttachment[] = [];
  for (const attachment of attachments) {
    const stored = await bucket.get(attachment.r2Key);
    if (!stored) throw new Error(PROMOTION_KIT_NOT_READY);
    const contentType = stored.httpMetadata?.contentType ?? "";
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if (contentType === "application/zip") {
      readStoredZipEntries(bytes).forEach((entry, index) => {
        const extension = entry.name.split(".").pop() ?? "";
        const entryType = ZIP_ENTRY_CONTENT_TYPES[extension];
        if (!entryType) throw new Error("Promotion archive holds an unexpected file");
        loaded.push({
          filename: `${attachment.filenameBase}-${String(index + 1).padStart(2, "0")}.${extension}`,
          contentType: entryType,
          base64Content: bytesToBase64(entry.bytes),
        });
      });
      continue;
    }
    const extension = FILE_EXTENSIONS[contentType];
    if (!extension) throw new Error("Promotion file has an unexpected type");
    loaded.push({
      filename: `${attachment.filenameBase}.${extension}`,
      contentType,
      base64Content: bytesToBase64(bytes),
    });
  }
  return loaded;
}

/** Resolves each kit format to its current rendered file, in one bounded read. */
export async function loadPromotionKitAttachments(
  db: DatabaseLike,
  bucket: Pick<R2Bucket, "get">,
  attachments: readonly QueuedPromotionKitAttachment[],
): Promise<LoadedEmailAttachment[]> {
  const current = await all<{ position: number; cache_key: string }>(
    db,
    `SELECT kit.key AS position,(SELECT render.cache_key FROM event_promotion_renders render
        WHERE render.event_id=json_extract(kit.value,'$.eventId') AND render.user_id=json_extract(kit.value,'$.userId')
          AND render.occurrence_id=json_extract(kit.value,'$.occurrenceId') AND render.format=json_extract(kit.value,'$.format')
          AND render.status='rendered'
        ORDER BY render.requested_at DESC LIMIT 1) AS cache_key
     FROM json_each(?) kit`,
    [JSON.stringify(attachments)],
  );
  const keys = new Map(current.map((row) => [row.position, row.cache_key]));
  return loadStoredFileAttachments(
    bucket,
    attachments.map((attachment, index) => {
      const r2Key = keys.get(index);
      if (!r2Key) throw new Error(PROMOTION_KIT_NOT_READY);
      return { r2Key, filenameBase: attachment.filenameBase };
    }),
  );
}

export function queuedBadgeRendererIsCurrent(attachment: QueuedBadgeAttachment, actual: string | undefined): boolean {
  return !attachment.renderer || personalPromotionRendererIsCurrent(attachment.renderer, actual);
}
