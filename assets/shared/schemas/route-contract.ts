import type { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import type { Permission } from "./permissions";

/**
 * Composable pieces for route contracts.
 *
 * Contracts repeated the same shape by hand: a success response, and some
 * subset of 400/401/403/404/409 each built from `jsonErrorResponse`. That was
 * several hundred lines of duplication, and because the authorization
 * declaration was a separate optional key it was easy to omit — which is why
 * most operations publish no security requirement at all.
 *
 * These are spread helpers rather than a wrapping builder on purpose. A
 * contract stays a plain object literal, so route handlers keep inferring
 * their validated request shape from it exactly as before. A builder that
 * returned a constructed object would erase that inference, trading real type
 * safety for shorter files.
 */

/** 200 response carrying a JSON body. */
export function ok(description: string, schema: z.ZodType) {
  return { "200": { description, content: { "application/json": { schema } } } } as const;
}

/** 201 response for an operation that creates a resource. */
export function created(description: string, schema: z.ZodType) {
  return { "201": { description, content: { "application/json": { schema } } } } as const;
}

/** 204 response. */
export function noContent(description: string) {
  return { "204": { description } } as const;
}

/**
 * The failures a session-authenticated operation always has. Pass the extra
 * ones it documents; 401 and 403 come for free so they are never forgotten
 * and never worded three different ways.
 */
export function authErrors(extra?: {
  badRequest?: string;
  notFound?: string;
  conflict?: string;
  gone?: string;
  unprocessable?: string;
  tooManyRequests?: string;
  forbidden?: string;
}) {
  return {
    ...(extra?.badRequest ? { "400": jsonErrorResponse(extra.badRequest) } : {}),
    "401": jsonErrorResponse("Authentication is required."),
    "403": jsonErrorResponse(extra?.forbidden ?? "The caller lacks the required permission."),
    ...(extra?.notFound ? { "404": jsonErrorResponse(extra.notFound) } : {}),
    ...(extra?.conflict ? { "409": jsonErrorResponse(extra.conflict) } : {}),
    ...(extra?.gone ? { "410": jsonErrorResponse(extra.gone) } : {}),
    ...(extra?.unprocessable ? { "422": jsonErrorResponse(extra.unprocessable) } : {}),
    ...(extra?.tooManyRequests ? { "429": jsonErrorResponse(extra.tooManyRequests) } : {}),
  };
}

/** Failures for an operation reached by a capability rather than a session. */
export function capabilityErrors(extra?: { badRequest?: string; notFound?: string; conflict?: string }) {
  return {
    ...(extra?.badRequest ? { "400": jsonErrorResponse(extra.badRequest) } : {}),
    "401": jsonErrorResponse("The supplied capability is missing, expired, or already used."),
    ...(extra?.notFound ? { "404": jsonErrorResponse(extra.notFound) } : {}),
    ...(extra?.conflict ? { "409": jsonErrorResponse(extra.conflict) } : {}),
  };
}

/** Failures for an operation anyone may call. */
export function publicErrors(extra?: { badRequest?: string; notFound?: string; tooManyRequests?: string }) {
  return {
    ...(extra?.badRequest ? { "400": jsonErrorResponse(extra.badRequest) } : {}),
    ...(extra?.notFound ? { "404": jsonErrorResponse(extra.notFound) } : {}),
    ...(extra?.tooManyRequests ? { "429": jsonErrorResponse(extra.tooManyRequests) } : {}),
  };
}

/**
 * Declares which permissions an operation checks. Spread at the top level of
 * the contract, beside `tags`.
 */
export function requiresPermissions(...scopes: Permission[]) {
  return { "x-pkic-auth": { required: true, scopes } } as const;
}

/** Declares an operation that needs a session but no particular permission. */
export function requiresSession() {
  return { "x-pkic-auth": { required: true, scopes: [] as Permission[] } } as const;
}

/** Declares an operation that needs at least one of several permission sets. */
export function requiresAnyPermissions(...scopesAnyOf: Permission[][]) {
  return { "x-pkic-auth": { required: true, scopesAnyOf } } as const;
}

/**
 * Declares an operation deliberately reachable without a session. Stating this
 * is what distinguishes "public by design" from "nobody has said yet".
 */
export function publicOperation() {
  return { "x-pkic-auth": { required: false } } as const;
}
