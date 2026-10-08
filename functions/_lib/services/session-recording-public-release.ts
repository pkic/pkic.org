import type { Env, StaticAssetsBinding } from "../types";
import {
  parseSessionRecordingPublicUrl,
  sessionRecordingPublicUrl,
  type SessionRecordingReleaseParams,
} from "../../../assets/shared/session-recording-public-url";
import { publicPublicationContent, publicPublicationContentRequest } from "./publication-content-response";

export async function publicSessionRecordingContent(
  assets: StaticAssetsBinding | undefined,
  bucket: R2Bucket | undefined,
  request: Request,
  input: SessionRecordingReleaseParams,
): Promise<Response> {
  return publicPublicationContent(assets, bucket, request, {
    url: sessionRecordingPublicUrl(input),
    kind: "recording",
  });
}

export function isSessionRecordingPublicPath(path: string): boolean {
  return /^\/api\/v1\/events\/[^/]+\/agenda\/occurrences\/[^/]+\/materials\/[^/]+\/recordings\/[^/]+\/releases\/[^/]+\/content\/?$/u.test(
    path,
  );
}

/** Reach this before middleware, availability and the version-scoped public API cache entrypoint. */
export async function publicSessionRecordingRequest(
  request: Request,
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC" | "SPEAKER_UPLOADS_BUCKET">,
) {
  const url = new URL(request.url);
  if (!isSessionRecordingPublicPath(url.pathname)) return null;
  const input = parseSessionRecordingPublicUrl(url.pathname);
  return publicPublicationContentRequest(
    request,
    env,
    input ? { url: sessionRecordingPublicUrl(input), kind: "recording" } : null,
  );
}
