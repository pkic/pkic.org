import { AVAILABILITY_ERROR_CODE } from "../../shared/schemas/availability";
import { publishAvailability, serviceAvailability } from "./availability-state";
import { TURNSTILE_TOKEN_HEADER, turnstileChallengeSchema } from "../../shared/schemas/abuse-protection";
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

function connectionError(): ApiClientError {
  return new ApiClientError(
    {
      error: {
        code: "NETWORK_UNAVAILABLE",
        message:
          "We could not reach online services. Keep this page open and check your connection. If you were saving a change, check whether it completed before trying again.",
      },
    },
    0,
  );
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }
  return response.json().catch((error: unknown) => {
    if (error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name))
      throw connectionError();
    return undefined;
  });
}

export interface JsonRequestInit extends RequestInit {
  mapError?: (payload: ApiErrorPayload, status: number) => ApiErrorPayload;
}

export type UnauthorizedHandler = (status: number) => void;
export type ErrorPayloadInterceptor = (payload: ApiErrorPayload, status: number) => ApiErrorPayload;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let errorPayloadInterceptor: ErrorPayloadInterceptor | null = null;

/**
 * Registers a side-effecting hook invoked once per unauthorized (401)
 * response, before the ApiClientError is thrown. Intended for a single
 * feature surface (e.g. the member portal, at bootstrap) to react to session
 * expiry — this module stays free of any feature-specific import so shared
 * code can never depend on a frontend feature. Pass `null` to remove the
 * handler (e.g. in test teardown).
 *
 * The handler may be invoked once for every in-flight request that resolves
 * with a 401 for the same expired session, so it must be safe to call
 * repeatedly in quick succession (idempotent).
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Registers a hook that can rewrite an error payload (e.g. its message)
 * before it is thrown, for every request that goes through `requestJson`.
 * Runs before any call-site `mapError`, so a call site can still further
 * refine the result. Pass `null` to remove the interceptor.
 */
export function setErrorPayloadInterceptor(interceptor: ErrorPayloadInterceptor | null): void {
  errorPayloadInterceptor = interceptor;
}

export async function requestJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init?: JsonRequestInit,
): Promise<z.output<Schema>> {
  const { mapError, ...requestInit } = init ?? {};
  const known = serviceAvailability.value;
  const path = new URL(url, typeof window === "undefined" ? "https://app.test" : window.location.href).pathname;
  if (known && known.mode !== "normal" && path.startsWith("/api/") && path !== "/api/v1/" && path !== "/api/v1") {
    throw new ApiClientError({ error: { code: AVAILABILITY_ERROR_CODE, message: known.message, details: known } }, 503);
  }
  const headers = new Headers(requestInit.headers);
  if (!headers.has("content-type") && typeof requestInit.body === "string") {
    headers.set("content-type", "application/json");
  }
  const send = async () => {
    try {
      const timeout = AbortSignal.timeout(30_000);
      const signal = requestInit.signal ? AbortSignal.any([requestInit.signal, timeout]) : timeout;
      return await fetch(url, { credentials: "same-origin", ...requestInit, headers, signal });
    } catch (error) {
      if (requestInit.signal?.aborted) throw error;
      throw connectionError();
    }
  };
  let response = await send();

  let body = await parseJson(response);
  const refusal = apiErrorPayloadSchema.safeParse(body);
  if (
    response.status === 403 &&
    refusal.success &&
    refusal.data.error.code === "TURNSTILE_REQUIRED" &&
    typeof window !== "undefined" &&
    new URL(url, window.location.href).origin === window.location.origin &&
    typeof requestInit.body === "string" &&
    !headers.has(TURNSTILE_TOKEN_HEADER)
  ) {
    const challenge = turnstileChallengeSchema.parse(refusal.data.error.details);
    const { requestTurnstileToken } = await import("./turnstile");
    const token = await requestTurnstileToken(challenge, requestInit.signal);
    headers.set(TURNSTILE_TOKEN_HEADER, token);
    // The server's challenge refusal guarantees the handler has not run. Retry once only.
    response = await send();
    body = await parseJson(response);
  }
  if (!response.ok) {
    const fallback: ApiErrorPayload = {
      error: {
        code: "HTTP_ERROR",
        message: [502, 503, 504].includes(response.status)
          ? "Online services are temporarily unavailable. Keep this page open. If you were saving a change, check whether it completed before trying again."
          : `HTTP ${response.status}`,
      },
    };
    const parsed = apiErrorPayloadSchema.safeParse(body);
    const payload = parsed.success ? parsed.data : fallback;
    if (response.status === 503 && payload.error.code === AVAILABILITY_ERROR_CODE)
      publishAvailability(payload.error.details);
    if (response.status === 401) {
      unauthorizedHandler?.(response.status);
    }
    const intercepted = errorPayloadInterceptor?.(payload, response.status) ?? payload;
    throw new ApiClientError(mapError?.(intercepted, response.status) ?? intercepted, response.status);
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

/**
 * Parses `body` through `requestSchema` before it is sent. A parse failure
 * throws synchronously (not as a rejected promise) with a message naming the
 * endpoint — an invalid request body is a programmer error, not something a
 * user triggered by typing in a form, so it must fail loudly during
 * development/testing rather than round-trip to the server first.
 *
 * Parsing (rather than merely type-checking) also means schema defaults and
 * transforms are applied before the request leaves the client, so the sent
 * body matches exactly what the shared contract says the server will see.
 */
function parseRequestBody<RequestSchema extends z.ZodType>(
  endpoint: string,
  requestSchema: RequestSchema,
  body: z.input<RequestSchema>,
): z.output<RequestSchema> {
  const result = requestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`Invalid request body for ${endpoint}: ${result.error.message}`);
  }
  return result.data;
}

export function postValidated<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType>(
  url: string,
  requestSchema: RequestSchema,
  body: z.input<RequestSchema>,
  responseSchema: ResponseSchema,
  headers?: Record<string, string>,
): Promise<z.output<ResponseSchema>> {
  return postJson(url, parseRequestBody(url, requestSchema, body), responseSchema, headers);
}

export function patchValidated<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType>(
  url: string,
  requestSchema: RequestSchema,
  body: z.input<RequestSchema>,
  responseSchema: ResponseSchema,
  headers?: Record<string, string>,
): Promise<z.output<ResponseSchema>> {
  return patchJson(url, parseRequestBody(url, requestSchema, body), responseSchema, headers);
}

export function putValidated<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType>(
  url: string,
  requestSchema: RequestSchema,
  body: z.input<RequestSchema>,
  responseSchema: ResponseSchema,
  headers?: Record<string, string>,
): Promise<z.output<ResponseSchema>> {
  return putJson(url, parseRequestBody(url, requestSchema, body), responseSchema, headers);
}
