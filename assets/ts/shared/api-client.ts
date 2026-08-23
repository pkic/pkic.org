import { z } from "zod";
import { apiErrorPayloadSchema, type ApiErrorPayload } from "../../shared/schemas/api-common";

export class ApiClientError extends Error {
  status: number;

  code: string;

  details: unknown;

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
    return undefined;
  }
  return response.json().catch(() => undefined);
}

export interface JsonRequestInit extends RequestInit {
  mapError?: (payload: ApiErrorPayload, status: number) => ApiErrorPayload;
}

export async function requestJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init?: JsonRequestInit,
): Promise<z.output<Schema>> {
  const { mapError, ...requestInit } = init ?? {};
  const headers = new Headers(requestInit.headers);
  if (!headers.has("content-type") && typeof requestInit.body === "string") {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    credentials: "same-origin",
    ...requestInit,
    headers,
  });

  const body = await parseJson(response);
  if (!response.ok) {
    const fallback: ApiErrorPayload = {
      error: {
        code: "HTTP_ERROR",
        message: `HTTP ${response.status}`,
      },
    };
    const parsed = apiErrorPayloadSchema.safeParse(body);
    const payload = parsed.success ? parsed.data : fallback;
    throw new ApiClientError(mapError?.(payload, response.status) ?? payload, response.status);
  }

  return schema.parse(body);
}

export function getJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init?: Pick<RequestInit, "signal">,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, { method: "GET", ...init });
}

export function postJson<Schema extends z.ZodType>(
  url: string,
  body: unknown,
  schema: Schema,
  headers?: Record<string, string>,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

export function patchJson<Schema extends z.ZodType>(
  url: string,
  body: unknown,
  schema: Schema,
  headers?: Record<string, string>,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers,
  });
}

export function putJson<Schema extends z.ZodType>(
  url: string,
  body: unknown,
  schema: Schema,
  headers?: Record<string, string>,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, {
    method: "PUT",
    body: JSON.stringify(body),
    headers,
  });
}

export function deleteJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  headers?: Record<string, string>,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, { method: "DELETE", headers });
}
