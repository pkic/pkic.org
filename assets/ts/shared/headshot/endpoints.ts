/**
 * Where a headshot is stored, as the tile sees it: one call that stores the
 * cropped image and one that removes it.
 *
 * Every headshot resource takes the same two methods on its own URL — a
 * person's record, the signed-in user, a proposal speaker, a token-bound
 * registration — and they differ only in how the image travels: as the
 * request body typed by its own media type, or as the `file` field of a form
 * for the routes that read multipart. The tile is written once against this
 * interface rather than once per resource.
 */
import type { z } from "zod";
import { requestJson } from "../api-client";
import { successResponseSchema, type ApiErrorPayload } from "../../../shared/schemas/api-common";

export interface HeadshotEndpoint {
  /** Stores the cropped image; resolves with the stored picture's URL when the server reports one. */
  upload(image: Blob): Promise<string | null>;
  remove(): Promise<void>;
}

/** The shared fallback, so a bare transport status never reaches the reader. */
function uploadFailure(payload: ApiErrorPayload): ApiErrorPayload {
  return payload.error.code === "HTTP_ERROR"
    ? { error: { ...payload.error, message: "Could not upload the photo." } }
    : payload;
}

function storedUrl(data: object): string | null {
  return "headshotUrl" in data && typeof data.headshotUrl === "string" ? data.headshotUrl : null;
}

async function removeAt(url: string): Promise<void> {
  await requestJson(url, successResponseSchema, { method: "DELETE" });
}

/** A resource that reads the image as the request body. */
export function headshotBodyEndpoint(url: string, responseSchema: z.ZodType<object>): HeadshotEndpoint {
  return {
    async upload(image) {
      const data = await requestJson(url, responseSchema, {
        method: "PUT",
        headers: { "content-type": image.type || "application/octet-stream" },
        body: image,
        mapError: uploadFailure,
      });
      return storedUrl(data);
    },
    remove: () => removeAt(url),
  };
}

/**
 * A resource that reads the image as the `file` field of a form. `fields`
 * carries what such a route asks for beside it, such as the registration
 * route's recorded consent.
 */
export function headshotFormEndpoint(
  url: string,
  responseSchema: z.ZodType<object>,
  fields: Record<string, string> = {},
): HeadshotEndpoint {
  return {
    async upload(image) {
      const body = new FormData();
      body.append("file", image, "headshot.jpg");
      for (const [name, value] of Object.entries(fields)) body.append(name, value);
      const data = await requestJson(url, responseSchema, { method: "PUT", body, mapError: uploadFailure });
      return storedUrl(data);
    },
    remove: () => removeAt(url),
  };
}
