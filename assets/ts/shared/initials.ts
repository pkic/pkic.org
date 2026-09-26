/**
 * Letters standing in for a picture that is not there.
 *
 * Two questions, not one, which is what three copies of "the initials" were
 * hiding: a person's initials and an organization's monogram are different
 * answers, and a surface that used the wrong one read wrong (a member's own
 * representative wore their employer's three-letter monogram).
 *
 * They live together because they are one idea with two subjects, and because
 * the copies drifted while they were apart — one of them stripped every
 * non-ASCII character, so Ó Súilleabháin came back as "S".
 */

/** Words, with punctuation-only fragments dropped. */
function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/**
 * A person's initials: the first letter of their first name and of their
 * last. Two letters, because that is what a face-sized round holds, and
 * because a person is known by those two.
 */
export function initialsFrom(name: string): string {
  const parts = words(name);
  if (parts.length === 0) return "";
  const first = [...parts[0]][0].toUpperCase();
  if (parts.length === 1) return first;
  return first + [...parts[parts.length - 1]][0].toUpperCase();
}

/**
 * An organization's monogram: the first letter of each of its first three
 * words. "Acme Business Limited" is ABL, the way it would be written on a
 * letterhead — not AL, which is what a person's rule would make of it.
 */
export function monogramFrom(name: string): string {
  return words(name)
    .slice(0, 3)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}
