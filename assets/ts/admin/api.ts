/**
 * Admin API client.
 *
 * Thin fetch wrapper that sends same-origin admin session cookies and handles
 * 401 responses by clearing auth (triggering a re-render to Login).
 */
import { clearAuth } from "./state";
import { ADMIN_PERMISSION_DENIED_MESSAGE } from "../../shared/auth-errors";
import { ApiClientError } from "../shared/api-client";
import type { ApiErrorPayload } from "../shared/types";

interface ApiOpts extends RequestInit {
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts?: ApiOpts): Promise<T> {
  const headers = new Headers(opts?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(path, {
    ...opts,
    credentials: "same-origin",
    headers,
  });

  const data: { error?: { message?: string; code?: string } } =
    res.status === 204 ? {} : await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
    }
    const errorCode = (data as ApiErrorPayload).error?.code ?? "HTTP_ERROR";
    const fallback: ApiErrorPayload = {
      error: {
        code: errorCode,
        message:
          errorCode === "SCOPE_REQUIRED"
            ? ADMIN_PERMISSION_DENIED_MESSAGE
            : ((data as ApiErrorPayload).error?.message ?? `HTTP ${res.status}`),
        details: (data as ApiErrorPayload).error?.details ?? null,
      },
    };
    throw new ApiClientError(fallback, res.status);
  }

  return data as T;
}
