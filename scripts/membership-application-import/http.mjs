/** Do not include response/error text: it can contain source data or credentials. */
export async function postImport({ origin, token, request, responseSchema, timeoutMs, signal, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${origin}/api/v1/members/applications/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status: response.status >= 500 ? "uncertain" : "failed",
        httpStatus: response.status,
        error: "http",
        stop: [401, 403, 429].includes(response.status) || response.status >= 500,
      };
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: "uncertain", error: "invalid_response", stop: true };
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 64 * 1024) {
          await reader.cancel();
          return { status: "uncertain", error: "invalid_response", stop: true };
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return { status: "uncertain", error: "invalid_response", stop: true };
    return { status: parsed.data.imported ? "imported" : "already_present", resultId: parsed.data.id, stop: false };
  } catch {
    return { status: "uncertain", error: signal.aborted ? "interrupted" : "transport_or_response", stop: true };
  }
}
