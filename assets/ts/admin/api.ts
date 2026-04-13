/**
 * Admin API client.
 *
 * Thin fetch wrapper that attaches the auth token from the global signal and
 * handles 401 responses by clearing auth (triggering a re-render to Login).
 */
import { clearAuth, authToken } from "./state";
import { ApiClientError } from "../shared/api-client";
import type { ApiErrorPayload } from "../shared/types";

interface ApiOpts extends RequestInit {
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts?: ApiOpts): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = authToken.value;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    ...opts,
    headers: { ...headers, ...(opts?.headers ?? {}) },
  });

  const data: { error?: { message?: string; code?: string } } =
    res.status === 204 ? {} : await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
    }
    const fallback: ApiErrorPayload = {
      error: {
        code: (data as ApiErrorPayload).error?.code ?? "HTTP_ERROR",
        message: (data as ApiErrorPayload).error?.message ?? `HTTP ${res.status}`,
        details: (data as ApiErrorPayload).error?.details ?? null,
      },
    };
    throw new ApiClientError(fallback, res.status);
  }

  return data as T;
}
