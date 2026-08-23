import { z, type ZodType } from "zod";
import { requestJson } from "./api-client";

/** Uploads a browser File as its native media type and validates the JSON response. */
export async function uploadFile<Schema extends ZodType>(
  url: string,
  file: Blob,
  schema: Schema,
  fallbackMessage = "Upload failed",
): Promise<z.output<Schema>> {
  return requestJson(url, schema, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    mapError: (payload) =>
      payload.error.code === "HTTP_ERROR" ? { error: { ...payload.error, message: fallbackMessage } } : payload,
  });
}
