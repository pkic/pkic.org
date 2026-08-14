import { downloadZip } from "client-zip";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";

export interface EventPresentationArchiveItem {
  proposalId: string;
  proposalTitle: string;
  r2Key: string;
  fileName: string | null;
  mimeType: string | null;
  uploadedAt: string;
  versionNumber: number;
  isCurrent: boolean;
}

interface EventPresentationArchiveRow {
  proposal_id: string;
  proposal_title: string;
  r2_key: string;
  file_name: string | null;
  mime_type: string | null;
  uploaded_at: string;
  version_number: number;
  is_current: number;
}

const PRESENTATION_EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptm",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

function archiveNamePart(value: string, fallback: string, maxLength = 120): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 _.-]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[ .-]+|[ .-]+$/g, "")
      .slice(0, maxLength)
      .replace(/[ .-]+$/g, "") || fallback
  );
}

function presentationExtension(item: EventPresentationArchiveItem): string {
  const fileExtension = item.fileName?.match(/\.(pdf|pptx|pptm|ppt|odp)$/i)?.[1];
  return fileExtension?.toLowerCase() ?? PRESENTATION_EXTENSION_BY_MIME[item.mimeType ?? ""] ?? "bin";
}

function archiveEntryName(
  item: EventPresentationArchiveItem,
  index: number,
  total: number,
  includeAllVersions: boolean,
): string {
  const position = String(index + 1).padStart(Math.max(3, String(total).length), "0");
  const title = archiveNamePart(item.proposalTitle, "Untitled presentation");
  const proposal = archiveNamePart(item.proposalId, "unknown", 12);
  const version = includeAllVersions
    ? ` - v${String(item.versionNumber).padStart(3, "0")}${item.isCurrent ? "-current" : ""}`
    : "";
  return `${position} - ${title} - ${proposal}${version}.${presentationExtension(item)}`;
}

export async function listEventPresentations(
  db: DatabaseLike,
  eventId: string,
  options: { includeAllVersions?: boolean } = {},
): Promise<EventPresentationArchiveItem[]> {
  const currentVersionCondition = options.includeAllVersions ? "" : "AND pv.is_current = 1";
  const rows = await all<EventPresentationArchiveRow>(
    db,
    `SELECT
       sp.id AS proposal_id,
       sp.title AS proposal_title,
       pv.r2_key,
       pv.file_name,
       pv.mime_type,
       pv.uploaded_at,
       pv.version_number,
       pv.is_current
     FROM session_proposals sp
     JOIN presentation_versions pv
       ON pv.proposal_id = sp.id
      AND pv.deleted_at IS NULL
      ${currentVersionCondition}
     WHERE sp.event_id = ?
       AND sp.status = 'accepted'
       AND sp.deleted_at IS NULL
     ORDER BY LOWER(sp.title), sp.id, pv.version_number`,
    [eventId],
  );

  return rows.map((row) => ({
    proposalId: row.proposal_id,
    proposalTitle: row.proposal_title,
    r2Key: row.r2_key,
    fileName: row.file_name,
    mimeType: row.mime_type,
    uploadedAt: row.uploaded_at,
    versionNumber: row.version_number,
    isCurrent: row.is_current === 1,
  }));
}

export function eventPresentationArchiveResponse(
  bucket: R2Bucket,
  eventSlug: string,
  items: EventPresentationArchiveItem[],
  options: { includeAllVersions?: boolean } = {},
): Response {
  async function* archiveInputs() {
    for (const [index, item] of items.entries()) {
      const name = archiveEntryName(item, index, items.length, options.includeAllVersions === true);
      let object: R2ObjectBody | null;
      try {
        object = await bucket.get(item.r2Key);
      } catch {
        object = null;
      }
      if (!object) {
        yield {
          name: `_missing/${name}.txt`,
          input: `The stored file for "${item.proposalTitle}" could not be found.`,
        };
        continue;
      }

      yield {
        name,
        input: new Response(object.body, {
          headers: {
            "content-length": String(object.size),
            "content-type": item.mimeType ?? "application/octet-stream",
          },
        }),
        size: object.size,
        lastModified: object.uploaded ?? new Date(item.uploadedAt),
      };
    }
  }

  const archive = downloadZip(archiveInputs(), { buffersAreUTF8: true });
  const headers = new Headers(archive.headers);
  const safeEventSlug = archiveNamePart(eventSlug, "event", 100).replace(/ /g, "-").toLowerCase();
  const suffix = options.includeAllVersions ? "presentations-all-versions" : "presentations";
  headers.set("Content-Disposition", `attachment; filename="${safeEventSlug}-${suffix}.zip"`);
  headers.set("Cache-Control", "no-store, max-age=0");
  return new Response(archive.body, { headers });
}
