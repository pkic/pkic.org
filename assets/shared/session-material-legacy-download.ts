import type { SessionMaterial } from "./schemas/event-session-history";
import type { LegacyAgendaDownload } from "./schemas/event-agenda-legacy-fragments";
import type { SessionPresentationVersion } from "./schemas/session-presentation-versions";

/** Match only an explicitly selected receipt to the exact uploaded PDF; ownership and approval remain caller guards. */
export function verifiedSessionMaterialLegacyDownload(
  material: SessionMaterial,
  downloads: readonly LegacyAgendaDownload[],
  version: Pick<SessionPresentationVersion, "id" | "versionNumber" | "sourceDigest" | "fileSize" | "mimeType">,
): LegacyAgendaDownload | null {
  if (
    material.kind !== "presentation" ||
    material.presentationSource !== "session" ||
    material.presentationVersionId !== version.id ||
    material.version !== version.versionNumber ||
    version.mimeType !== "application/pdf" ||
    material.legacyDownloadUrl === null
  )
    return null;
  return (
    downloads.find(
      (receipt) =>
        receipt.url === material.legacyDownloadUrl &&
        receipt.pdfDigest !== null &&
        receipt.pdfBytes !== null &&
        receipt.pdfDigest === version.sourceDigest &&
        receipt.pdfBytes === version.fileSize,
    ) ?? null
  );
}
