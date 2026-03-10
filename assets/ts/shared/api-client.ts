import type { ApiErrorPayload } from "./types";

export class ApiClientError extends Error {
  status: number;

  code: string;

  details: ApiErrorPayload["error"]["details"];

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = payload.error.code;
    this.details = payload.error.details ?? null;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await parseJson(response)) as T | ApiErrorPayload | null;
  if (!response.ok) {
    const fallback: ApiErrorPayload = {
      error: {
        code: "HTTP_ERROR",
        message: `Request failed with status ${response.status}`,
      },
    };
    throw new ApiClientError((body as ApiErrorPayload) ?? fallback, response.status);
  }

  return (body ?? {}) as T;
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url, { method: "GET" });
}

export function postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return request<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

export function patchJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return request<T>(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers,
  });
}
