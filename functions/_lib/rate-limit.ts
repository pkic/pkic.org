import { AppError } from "./errors";
import { sha256Hex } from "./utils/crypto";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface RateLimitOptions {
  binding: RateLimitBinding | null | undefined;
  namespace: string;
  key: string | null | undefined;
  retryAfterSeconds?: number;
}

async function bucketKey(options: RateLimitOptions): Promise<string> {
  const keyHash = await sha256Hex(options.key?.trim().toLowerCase() || "unknown");
  return `${options.namespace}:${keyHash}`;
}

export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  if (!options.binding) {
    throw new AppError(503, "RATE_LIMIT_UNAVAILABLE", "Rate limiting is not available.");
  }

  const outcome = await options.binding.limit({ key: await bucketKey(options) });
  if (!outcome.success) {
    throw new AppError(429, "RATE_LIMITED", "Too many requests. Please try again later.", {
      retryAfter: options.retryAfterSeconds ?? 60,
    });
  }
}
