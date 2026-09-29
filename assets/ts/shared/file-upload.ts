import { z, type ZodType } from "zod";
import { requestJson } from "./api-client";

async function sendFile<Schema extends ZodType>(
  method: "POST" | "PUT",
  url: string,
  file: Blob,
  schema: Schema,
  fallbackMessage: string,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, {
    method,
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    mapError: (payload) =>
      payload.error.code === "HTTP_ERROR" ? { error: { ...payload.error, message: fallbackMessage } } : payload,
  });
}

/** Creates a file-backed resource from the browser file's native media type. */
export function uploadFile<Schema extends ZodType>(
  url: string,
  file: Blob,
  schema: Schema,
  fallbackMessage = "Upload failed",
): Promise<z.output<Schema>> {
  return sendFile("POST", url, file, schema, fallbackMessage);
}

/** Replaces a singular file-backed resource from the browser file's native media type. */
export function replaceFile<Schema extends ZodType>(
  url: string,
  file: Blob,
  schema: Schema,
  fallbackMessage = "Upload failed",
): Promise<z.output<Schema>> {
  return sendFile("PUT", url, file, schema, fallbackMessage);
}
