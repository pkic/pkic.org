import { AppError } from "./errors";
import { hmacSha256Hex } from "./utils/crypto";
import type { Env } from "./types";

export function getClientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent") ?? null;
}

export function requireInternalSecret(env: Env): string {
  const secret = env.INTERNAL_SIGNING_SECRET;
  if (!secret) {
    throw new AppError(
      500,
      "INTERNAL_SECRET_MISSING",
      "INTERNAL_SIGNING_SECRET is not configured. Set it in .dev.vars for local dev or as a Wrangler secret for deployed environments.",
    );
  }
  return secret;
}

export async function hashOptional(value: string | null, secret: string): Promise<string | null> {
  if (!value) {
    return null;
  }
  return hmacSha256Hex(secret, value);
}
