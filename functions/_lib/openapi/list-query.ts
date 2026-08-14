import type { z } from "zod";
import { AppError } from "../errors";

/**
 * Validates a list endpoint's query string against its Zod schema, throwing
 * the same AppError("VALIDATION_ERROR", ...) that parseJsonBody throws for
 * invalid request bodies — the app-level onError handler formats both into
 * the same `{error:{code,message,details}}` shape. Every admin list route
 * (organizations, applications, sponsorships, members, content-reviews)
 * shares this instead of each hand-rolling its own "parsed.success ? ... :
 * default" silent fallback for invalid input.
 */
export function parseListQuery<T extends z.ZodTypeAny>(schema: T, url: URL, paramNames: readonly string[]): z.infer<T> {
  const raw: Record<string, string | undefined> = {};
  for (const name of paramNames) {
    raw[name] = url.searchParams.get(name) ?? undefined;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid query parameters", parsed.error.flatten());
  }

  return parsed.data;
}
