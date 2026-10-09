import { SiteImage } from "../site/SiteImage";
import { headshotVariantSources } from "../../shared/headshot-variants";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

import "./Avatar.css";
// The ring and label only portal surfaces wear; kept out of the entry stylesheet public pages link.
import "./AvatarStanding.css";
import { initialsFrom, monogramFrom } from "../shared/initials";

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
   * doing so; the shape is the caller's because the subject is. The letters
   * follow the subject too: a person's initials, an organization's monogram.
   */
  shape?: "round" | "square";
  /**
   * Draw the stored portrait itself rather than its bounded renditions. Only
   * a surface that shows the portrait as a picture — a profile dialog — wants
   * this; every avatar-sized use asks the headshot route for a small square.
   */
  original?: boolean;
}

export interface AvatarStatus {
  label: string;
  /** `accent` for a standing held now, `neutral` for one held before. */
  tone?: "accent" | "neutral";
}

export function Avatar({ name, src, size = "md", status, shape = "round", original = false, ...rest }: AvatarProps) {
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
        <SiteImage
          portrait
          {...rest}
          {...portraitSources(src, original, size, rest.sizes)}
          alt=""
          loading="lazy"
          class="pk-avatar__img"
          onError={() => setBroken(true)}
        />
      ) : (
        <span class="pk-avatar__initials">{shape === "square" ? monogramFrom(name) : initialsFrom(name)}</span>
      )}
    </div>
  );

  if (!status) return portrait;

  return <AvatarStanding status={status}>{portrait}</AvatarStanding>;
}

/**
 * A live headshot address becomes a small square rendition with a width
 * `srcset`; any other source (a published asset, a logo) passes through for
 * the site image pipeline to size.
 */
/**
 * The rendered width of each avatar size (Avatar.css). Lazy images pick their
 * rendition before every stylesheet has loaded, when "auto" can still measure
 * an unstyled, full-width image, so a known avatar states its own slot.
 */
const AVATAR_SLOT: Record<AvatarSize, string> = { sm: "2rem", md: "2.5rem", lg: "3rem", xl: "5.75rem" };

function portraitSources(src: string, original: boolean, size: AvatarSize, sizes: AvatarProps["sizes"]) {
  const variants = original ? null : headshotVariantSources(src);
  return variants ? { ...variants, sizes: sizes ?? AVATAR_SLOT[size] } : { src };
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
