import type { JSX } from "preact";

import "./Avatar.css";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps extends Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "size"> {
  name: string;
  src?: string;
  size?: AvatarSize;
  /**
   * A standing the person holds, drawn as a ring around the portrait and a
   * label across its foot — "Board member", "Chair".
   *
   * `neutral` is the past tense of `accent`: the ring loses the brand gradient
   * and the portrait is desaturated, so a former chair reads as former without
   * the label having to say "(past)". The label is real text, not a title
   * attribute, because the ring alone states nothing to a reader who cannot
   * see it.
   */
  status?: AvatarStatus;
}

export interface AvatarStatus {
  label: string;
  /** `accent` for a standing held now, `neutral` for one held before. */
  tone?: "accent" | "neutral";
}

/**
 * Extract initials from a name.
 *
 * Takes the first letter of the first word and the first letter of the last
 * word, uppercase them. Handles single words (one letter), empty/whitespace-only
 * input (returns ""), and non-ASCII letters.
 */
export function initialsFrom(name: string): string {
  if (!name) return "";

  const trimmed = name.trim();
  if (!trimmed) return "";

  // Collapse repeated whitespace and split into words
  const words = trimmed.split(/\s+/);
  const filtered = words.filter((w) => w.length > 0);

  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0][0].toUpperCase();

  const first = filtered[0][0].toUpperCase();
  const last = filtered[filtered.length - 1][0].toUpperCase();

  return first + last;
}

export function Avatar({ name, src, size = "md", status, ...rest }: AvatarProps) {
  const classes = ["pk-avatar", size === "md" ? null : `pk-avatar--${size}`].filter(Boolean).join(" ");

  const portrait = (
    <div class={classes} aria-hidden="true">
      {src ? (
        <img {...rest} src={src} alt="" loading="lazy" class="pk-avatar__img" />
      ) : (
        <span class="pk-avatar__initials">{initialsFrom(name)}</span>
      )}
    </div>
  );

  if (!status) return portrait;

  return (
    <span class="pk-avatar-standing" data-tone={status.tone ?? "accent"}>
      <span class="pk-avatar-standing__ring">{portrait}</span>
      <span class="pk-avatar-standing__label">{status.label}</span>
    </span>
  );
}
