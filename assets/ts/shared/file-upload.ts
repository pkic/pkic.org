/** Uploads a browser File as its native media type and normalizes API errors. */
export async function uploadFile<T = unknown>(url: string, file: Blob, fallbackMessage = "Upload failed"): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? fallbackMessage);
  }
  return body;
}
