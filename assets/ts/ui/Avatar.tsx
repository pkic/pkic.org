import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

import "./Avatar.css";
import { initialsFrom } from "../shared/initials";

export { initialsFrom, monogramFrom } from "../shared/initials";

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
  /**
   * `round` is a person. An organization's mark is a logo, and a logo in a
   * circle is cropped where a face is framed — so a square with the picture
   * fitted inside it, never cut. Every surface that draws people round keeps
   * doing so; the shape is the caller's because the subject is.
   */
  shape?: "round" | "square";
}

export interface AvatarStatus {
  label: string;
  /** `accent` for a standing held now, `neutral` for one held before. */
  tone?: "accent" | "neutral";
}

export function Avatar({ name, src, size = "md", status, shape = "round", ...rest }: AvatarProps) {
  const classes = [
    "pk-avatar",
    size === "md" ? null : `pk-avatar--${size}`,
    shape === "square" ? "pk-avatar--square" : null,
  ]
    .filter(Boolean)
    .join(" ");
  /*
   * "No usable portrait" includes one the browser could not load. A stored
   * headshot whose object has gone missing leaves a broken `<img>`, which
   * collapses to a few pixels and reads as a squashed ring — issue #25's oval,
   * on every portal list row rather than on a governance card. The public
   * person card already fell back to initials here; the design-system avatar
   * every other surface reaches for did not.
   */
  const [broken, setBroken] = useState(false);

  const portrait = (
    <div class={classes} aria-hidden="true">
      {src && !broken ? (
        <img {...rest} src={src} alt="" loading="lazy" class="pk-avatar__img" onError={() => setBroken(true)} />
      ) : (
        <span class="pk-avatar__initials">{initialsFrom(name)}</span>
      )}
    </div>
  );

  if (!status) return portrait;

  return <AvatarStanding status={status}>{portrait}</AvatarStanding>;
}

/**
 * The ring and the word worn on a portrait.
 *
 * Exported because the portrait underneath is not always this component's: a
 * record whose reader may change the photograph shows a `PictureTile` there
 * instead, and it wears the same standing. Written once so the two cannot
 * drift into two rings.
 */
export function AvatarStanding({ status, children }: { status: AvatarStatus; children: ComponentChildren }) {
  return (
    <span class="pk-avatar-standing" data-tone={status.tone ?? "accent"}>
      <span class="pk-avatar-standing__ring">{children}</span>
      <span class="pk-avatar-standing__label">{status.label}</span>
    </span>
  );
}
