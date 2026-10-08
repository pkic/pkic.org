import { posix } from "node:path";
import { contentMediaUrl } from "../../assets/shared/content-media-url.ts";
import { legacyAgendaDownloadSchema } from "../../assets/shared/schemas/event-agenda-legacy-fragments.ts";

/** A verified exact local filename preserves its original Hugo event-bundle download path. */
export function legacyAgendaDownloads(session, context, assets = []) {
  const reference = session.presentation;
  if (!reference || !context.sourcePath.startsWith("content/events/")) return [];
  const asset = assets.find((candidate) => candidate.authoredReference === reference);
  // Reviewed filename substitutions and globs do not establish an originally emitted Hugo href.
  if (
    !asset ||
    asset.relativePath !== reference ||
    asset.localMapping ||
    !/^[a-f0-9]{64}$/u.test(asset.sourceDigest) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0
  )
    return [];
  const targetUrl = contentMediaUrl(`${posix.dirname(context.sourcePath.slice("content/".length))}/${reference}`);
  if (asset.publicUrl !== targetUrl) return [];
  const download = {
    url: targetUrl.replace(/^\/content-media/u, ""),
    targetUrl,
    sourcePath: context.sourcePath,
    sourceDigest: context.sourceDigest,
    sourceLocator: context.sourceKey,
    pdfDigest: asset.sourceDigest,
    pdfBytes: asset.bytes,
  };
  return legacyAgendaDownloadSchema.safeParse(download).success ? [download] : [];
}
