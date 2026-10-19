import { z } from "zod";

const SLUG_MAX_LENGTH = 80;

/** A readable public page address segment: lower-case ASCII words joined by single hyphens. */
export const publicPageSlugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Use lower-case letters, digits and single hyphens");

/** The readable base of an address, derived from an approved name or title. */
export function publicPageSlugBase(text: string, fallback: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/[æÆ]/gu, "ae")
    .replace(/[øØ]/gu, "o")
    .replace(/[łŁ]/gu, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, SLUG_MAX_LENGTH - 4)
    .replace(/-+$/u, "");
  return base || fallback;
}

/** A taken slug's own base: the trailing collision suffix ("-2", "-3", …) is not part of the name. */
export function publicPageSlugNameBase(slug: string): string {
  return slug.replace(/-[1-9][0-9]*$/u, "");
}

/** The first free address for a base: the base itself, then base-2, base-3, … */
export function nextPublicPageSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A person's address comes from the name they approved for publication, else their account name. */
export const personProfileSlugBase = (displayName: string) => publicPageSlugBase(displayName, "person");
/** A session's address comes from its approved title. */
export const sessionPageSlugBase = (title: string) => publicPageSlugBase(title, "session");
