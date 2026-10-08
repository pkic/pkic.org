import type { Env, StaticAssetsBinding } from "../types";
import {
  parseSessionPresentationPublicUrl,
  sessionPresentationPublicUrl,
  type SessionPresentationReleaseParams,
} from "../../../assets/shared/session-presentation-public-url";
import { publicPublicationContent, publicPublicationContentRequest } from "./publication-content-response";

export async function publicSessionPresentationContent(
  assets: StaticAssetsBinding | undefined,
  bucket: R2Bucket | undefined,
  request: Request,
  input: SessionPresentationReleaseParams,
): Promise<Response> {
  return publicPublicationContent(assets, bucket, request, {
    url: sessionPresentationPublicUrl(input),
    kind: "presentation",
  });
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
  const input = parseSessionPresentationPublicUrl(url.pathname);
  return publicPublicationContentRequest(
    request,
    env,
    input ? { url: sessionPresentationPublicUrl(input), kind: "presentation" } : null,
  );
}
