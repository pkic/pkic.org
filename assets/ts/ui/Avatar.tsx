import type { JSX } from "preact";

import "./Avatar.css";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "size"> {
  name: string;
  src?: string;
  size?: AvatarSize;
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

export function Avatar({ name, src, size = "md", ...rest }: AvatarProps) {
  const classes = ["pk-avatar", size === "md" ? null : `pk-avatar--${size}`].filter(Boolean).join(" ");

  return (
    <div class={classes} aria-hidden="true">
      {src ? (
        <img {...rest} src={src} alt="" loading="lazy" class="pk-avatar__img" />
      ) : (
        <span class="pk-avatar__initials">{initialsFrom(name)}</span>
      )}
    </div>
  );
}
