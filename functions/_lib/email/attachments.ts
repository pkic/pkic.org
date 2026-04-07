export interface QueuedEmailAttachment {
  kind: "r2-badge-image";
  r2Key: string;
  filenameBase: string;
}

function slugifyAttachmentPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
}): QueuedEmailAttachment {
  const filenamePrefix = payload.badgeType === "donation" ? "donation-badge" : "attendee-badge";
  const namePart = resolveAttachmentNamePart(payload.firstName, payload.lastName, payload.name);

  return {
    kind: "r2-badge-image",
    r2Key: `og-badges/${payload.badgeCode}`,
    filenameBase: namePart ? `${filenamePrefix}-${namePart}` : filenamePrefix,
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
    return candidate.kind === "r2-badge-image"
      && typeof candidate.r2Key === "string"
      && candidate.r2Key.length > 0
      && typeof candidate.filenameBase === "string"
      && candidate.filenameBase.length > 0;
  });
}