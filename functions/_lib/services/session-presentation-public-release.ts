import type { Env, StaticAssetsBinding } from "../types";
import { getStaticAssetsBinding } from "../static-assets";
import { AppError } from "../errors";
import {
  parseSessionPresentationPublicUrl,
  sessionPresentationPublicUrl,
  type SessionPresentationReleaseParams,
} from "../../../assets/shared/session-presentation-public-url";
import {
  sitePublicationDocumentRoutesSchema,
  PUBLICATION_DOCUMENT_ROUTES_PATH,
} from "../../../assets/shared/schemas/site-publication-release";
import { publicationDocumentStorageKey } from "../../../assets/shared/schemas/site-publication-documents";
import { readPublicationDocumentAllow } from "./site-publication-document-projection";
import { presentationDownloadResponse } from "./presentation-versions";

function notFound(): never {
  throw new AppError(404, "PUBLIC_PRESENTATION_NOT_FOUND", "Published presentation not found");
}
function rangeFor(request: Request, size: number, etag: string) {
  const value = request.headers.get("range");
  if (
    !value ||
    request.method !== "GET" ||
    (request.headers.has("if-range") && request.headers.get("if-range") !== etag)
  )
    return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const first = match[1] ? Number(match[1]) : null,
    last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return false;
  if (first === null) {
    if (!last) return false;
    const length = Math.min(last, size);
    return { offset: size - length, length };
  }
  if (first >= size || (last !== null && last < first)) return false;
  return { offset: first, length: Math.min(last ?? size - 1, size - 1) - first + 1 };
}

/** Deployed immutable selection plus uncached private R2 authority; no DB/auth lookup or static PDF fallback. */
export async function publicSessionPresentationContent(
  assets: StaticAssetsBinding | undefined,
  bucket: R2Bucket | undefined,
  request: Request,
  input: SessionPresentationReleaseParams,
): Promise<Response> {
  if (!assets || !bucket) notFound();
  const artifact = await assets.fetch(new Request(new URL(`/${PUBLICATION_DOCUMENT_ROUTES_PATH}`, request.url)));
  if (!artifact.ok) notFound();
  const routes = sitePublicationDocumentRoutesSchema.parse(await artifact.json());
  const selected = routes.documents.find(({ url }) => url === sessionPresentationPublicUrl(input));
  if (!selected) notFound();
  const allow = await readPublicationDocumentAllow(bucket, selected.grantId);
  if (!allow || sessionPresentationPublicUrl(allow) !== sessionPresentationPublicUrl(input)) notFound();
  const head = await bucket.head(allow.r2Key);
  if (!head || head.size !== allow.fileSize || head.etag !== allow.objectEtag) notFound();
  const etag = `"${input.digest}"`;
  const headers = presentationDownloadResponse(
    {
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      size: allow.fileSize,
    },
    { ...allow, mimeType: "application/pdf" },
  ).headers;
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("etag", etag);
  headers.set("accept-ranges", "bytes");
  if (await bucket.head(publicationDocumentStorageKey(allow.grantId, "deny"))) notFound();
  if (
    request.headers
      .get("if-none-match")
      ?.split(",")
      .some((value) => value.trim() === "*" || value.trim().replace(/^W\//u, "") === etag)
  ) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { headers });
  const range = rangeFor(request, allow.fileSize, etag);
  if (range === false) {
    headers.set("content-range", `bytes */${allow.fileSize}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  const object = await bucket.get(allow.r2Key, {
    onlyIf: { etagMatches: allow.objectEtag },
    ...(range ? { range } : {}),
  });
  if (
    !object ||
    !("body" in object) ||
    object.size !== allow.fileSize ||
    object.etag !== allow.objectEtag ||
    (await bucket.head(publicationDocumentStorageKey(allow.grantId, "deny")))
  ) {
    if (object && "body" in object) await object.body.cancel().catch(() => {});
    notFound();
  }
  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${allow.fileSize}`);
    headers.set("content-length", String(range.length));
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export function isSessionPresentationPublicPath(path: string): boolean {
  return /^\/api\/v1\/events\/[^/]+\/agenda\/occurrences\/[^/]+\/materials\/presentations\/[^/]+\/releases\/[^/]+\/content\/?$/u.test(
    path,
  );
}

/** Reach this before middleware, availability and the version-scoped public API cache entrypoint. */
export async function publicSessionPresentationRequest(
  request: Request,
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC" | "SPEAKER_UPLOADS_BUCKET">,
) {
  const url = new URL(request.url);
  if (!isSessionPresentationPublicPath(url.pathname)) return null;
  const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, HEAD" } });
  const input = parseSessionPresentationPublicUrl(url.pathname);
  if (!input || url.search) return new Response(null, { status: 404, headers: noStore });
  try {
    return await publicSessionPresentationContent(
      getStaticAssetsBinding(env),
      env.SPEAKER_UPLOADS_BUCKET,
      request,
      input,
    );
  } catch (error) {
    return new Response(null, {
      status: error instanceof AppError && error.status === 404 ? 404 : 503,
      headers: noStore,
    });
  }
}
