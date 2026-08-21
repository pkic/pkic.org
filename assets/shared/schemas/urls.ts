import { z } from "zod";

export const MAX_URL_LENGTH = 500;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

/** Canonical absolute-link contract. Userinfo and non-HTTP schemes are never accepted. */
export const httpUrlSchema = z.string().trim().url().max(MAX_URL_LENGTH).refine(isHttpUrl, "Must be an HTTP(S) URL");

/** Same-origin path; rejects scheme-relative and backslash-normalized URLs. */
export const sameOriginPathSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine((path) => path.startsWith("/"), "Must be a relative path starting with /")
  .refine((path) => !path.startsWith("//"), "Must not be a scheme-relative URL")
  .refine((path) => !path.includes("//"), "Must not contain //")
  .refine((path) => !path.includes("\\"), "Must not contain backslashes");

/** Redirects are deliberately same-origin only. */
export const relativeRedirectPathSchema = sameOriginPathSchema;

/** Asset references may be a same-origin path or an explicit HTTP(S) URL. */
export const httpOrSameOriginUrlSchema = z.union([sameOriginPathSchema, httpUrlSchema]);

/**
 * Tolerant read helper for legacy URL columns. Invalid historic values are
 * omitted instead of being reflected into API responses or fetch sinks.
 */
export function sanitizeLegacyHttpUrl(value: unknown): string | null {
  const parsed = httpUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Tolerant read helper for legacy asset/link values that may be same-origin. */
export function sanitizeLegacyHttpOrSameOriginUrl(value: unknown): string | null {
  const parsed = httpOrSameOriginUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** True only for the requested hostname or one of its subdomains. */
export function hasUrlHostname(value: string, hostname: string): boolean {
  const parsed = httpUrlSchema.safeParse(value);
  if (!parsed.success) return false;
  const actual = new URL(parsed.data).hostname.toLowerCase();
  const expected = hostname.toLowerCase().replace(/^www\./, "");
  return actual === expected || actual.endsWith(`.${expected}`);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

/**
 * Normalizes same-site and local-development absolute URLs to a portable
 * same-origin path while preserving legitimate external HTTP(S) URLs.
 */
export function normalizeHttpOrSameOriginUrl(value: string, siteBaseUrl: string): string {
  const parsedValue = httpOrSameOriginUrlSchema.parse(value);
  if (parsedValue.startsWith("/")) return parsedValue;

  const url = new URL(parsedValue);
  const site = new URL(httpUrlSchema.parse(siteBaseUrl));
  if (url.origin === site.origin || isLoopbackHostname(url.hostname)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}
