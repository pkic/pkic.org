/**
 * Admin API client.
 *
 * Thin fetch wrapper that sends same-origin admin session cookies and handles
 * 401 responses by clearing auth (triggering a re-render to Login).
 */
import { clearAuth } from "./state";
import { ADMIN_PERMISSION_DENIED_MESSAGE } from "../../shared/auth-errors";
import { z } from "zod";
import { requestJson } from "../shared/api-client";
import { successResponseSchema } from "../../shared/schemas/api-common";

interface ApiOpts extends RequestInit {
  headers?: Record<string, string>;
}

export function api<Schema extends z.ZodType>(path: string, schema: Schema, opts?: ApiOpts): Promise<z.output<Schema>> {
  return requestJson(path, schema, {
    ...opts,
    mapError: (payload, status) => {
      if (status === 401) clearAuth();
      if (payload.error.code !== "SCOPE_REQUIRED") return payload;
      return {
        error: {
          ...payload.error,
          message: ADMIN_PERMISSION_DENIED_MESSAGE,
        },
      };
    },
  });
}

/** Canonical command wrapper for admin endpoints with no domain payload. */
export function apiCommand(path: string, opts?: ApiOpts): Promise<z.output<typeof successResponseSchema>> {
  return api(path, successResponseSchema, opts);
}
