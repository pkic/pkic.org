import {
  PERSONAL_PROMOTION_RENDERER,
  personalPromotionImageCacheKey,
  personalPromotionRendererIsCurrent,
} from "../../../assets/shared/personal-promotion-image";
import { bytesToBase64 } from "../../../assets/shared/base64";
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

/** A rendered file in storage; the object's own content type names the file type. */
export interface QueuedStoredFileAttachment {
  kind: "r2-stored-file";
  r2Key: string;
  filenameBase: string;
}

export type QueuedEmailAttachment = QueuedBadgeAttachment | QueuedStoredFileAttachment;

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

    if (candidate.kind === "r2-stored-file") {
      return (
        typeof candidate.r2Key === "string" &&
        candidate.r2Key.length > 0 &&
        typeof candidate.filenameBase === "string" &&
        candidate.filenameBase.length > 0
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
  attachments: readonly QueuedStoredFileAttachment[],
): Promise<LoadedEmailAttachment[]> {
  const loaded: LoadedEmailAttachment[] = [];
  for (const attachment of attachments) {
    const stored = await bucket.get(attachment.r2Key);
    if (!stored) throw new Error("Required promotion file is no longer available");
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

export function queuedBadgeRendererIsCurrent(attachment: QueuedBadgeAttachment, actual: string | undefined): boolean {
  return !attachment.renderer || personalPromotionRendererIsCurrent(attachment.renderer, actual);
}
