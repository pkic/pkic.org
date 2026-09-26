/**
 * The one way this codebase turns a human title into a URL segment.
 *
 * Five copies of this four-line function had grown up independently — group
 * types, votes, meeting series, group events, form keys — and they had already
 * drifted: some trimmed first, some capped the length, some stripped only a
 * single leading dash rather than a run of them. A slug is a persisted,
 * user-visible identifier, so two rules producing two different segments for
 * the same title is a real difference, not a stylistic one.
 *
 * The shape is deliberately conservative: lower case, ASCII letters and digits,
 * every other run collapsed to a single hyphen, no hyphen at either end. It
 * makes no attempt to transliterate — a name written in a non-Latin script
 * slugifies to the empty string, which callers turn into their own fallback
 * rather than into mojibake.
 */

/** How long a generated segment may be before it is cut. */
export const DEFAULT_SLUG_MAX_LENGTH = 200;

export interface SlugifyOptions {
  /** Cut the result to this many characters (default {@link DEFAULT_SLUG_MAX_LENGTH}). */
  maxLength?: number;
}

export function slugify(value: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_SLUG_MAX_LENGTH;
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      // Cutting can land on a hyphen, which would leave the segment ending in
      // one — a shape the rule above already rejected.
      .replace(/-+$/, "")
  );
}

/**
 * A slug for `value`, or `fallback` when it reduces to nothing.
 *
 * Every caller needs this: a title of "—" or one written entirely in a
 * non-Latin script yields an empty segment, and an empty segment is not a URL.
 */
export function slugifyOr(value: string, fallback: string, options: SlugifyOptions = {}): string {
  return slugify(value, options) || fallback;
}

/**
 * The first of `base`, `base-2`, `base-3`, … that `taken` does not reject.
 *
 * The suffix search is what every caller wrote for itself around its own
 * "is this slug free" query; only that query differs, so it is the parameter.
 * `limit` bounds the walk: a caller whose collision count reaches it has a
 * data problem rather than a naming one, and looping forever would hide it.
 */
export async function firstFreeSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  limit = 1000,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let suffix = 2; suffix <= limit; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free slug for "${base}" within ${limit} attempts`);
}
