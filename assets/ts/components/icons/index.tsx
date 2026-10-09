/**
 * Reusable inline SVG icon components for dynamically-built UI.
 *
 * Every icon here is decorative: it repeats something the text beside it
 * already says, so each is hidden from assistive technology and taken out of
 * the tab order rather than being given a name that would be announced twice.
 * A caller that needs a *named* icon passes `aria-hidden={undefined}` and its
 * own `role`/`aria-label`, which the spread below lets it do.
 *
 * They carry no spacing of their own. The gap between an icon and its label
 * belongs to the parent — `pk-btn` and `pk-cluster` are both flex with a
 * `gap` — so a margin here would be a second, disagreeing decision.
 */
import type { JSX } from "preact";

import { StrokeIcon } from "../../ui/MediaIcons";
export {
  StrokeIcon,
  IconVideo,
  IconDownload,
  IconFilter,
  IconSearch,
  IconRemove,
  IconPencil,
  IconLink,
  IconExternalLink,
  IconVirtual,
  IconOnDemand,
  IconCalendar,
  IconMapPin,
} from "../../ui/MediaIcons";

type SvgProps = Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">;

// ── UI icons ────────────────────────────────────────────────────────────────
//
// Outlines on the shared 16-unit grid, drawn through `StrokeIcon` so they take
// the one icon weight. Glyphs a server-rendered site component also needs live
// in `ui/MediaIcons` and are re-exported above.

/**
 * An organization member, as opposed to an individual (`IconPerson`).
 *
 * Named rather than decorative at every call site so far — it stands in for a
 * word rather than repeating one — so the caller passes
 * `aria-hidden={undefined}` with its own `role` and `aria-label`.
 */
export function IconOrganization(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      {/* A block with a door, not a facade of windows: at 16px the detailed one
          read as noise rather than as a building. */}
      <path d="M3.5 14V2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V14M2 14h12M6.5 14v-2.5h3V14M6 4.5h1M9 4.5h1M6 7h1M9 7h1" />
    </StrokeIcon>
  );
}

export function IconPlus(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 3v10M3 8h10" />
    </StrokeIcon>
  );
}

export function IconRefresh(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M13 6A5 5 0 0 0 4.2 4.2L3 5.5M3 2.5v3h3M3 10a5 5 0 0 0 8.8 1.8L13 10.5M10 10.5h3v3" />
    </StrokeIcon>
  );
}

export function IconCheckmark(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m3 8 3 3 7-7" />
    </StrokeIcon>
  );
}

export function IconInfoCircle(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 4.5h.01" />
    </StrokeIcon>
  );
}

/** Stacked sheets: duplicates, and the layered block library. */
export function IconLayers(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m8 2 6 3.5L8 9 2 5.5 8 2ZM2 9l6 3.5L14 9M2 12l6 3.5 6-3.5" />
    </StrokeIcon>
  );
}

/** A template variable. */
export function IconBraces(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M5.5 2H4.5a1 1 0 0 0-1 1v3L2 8l1.5 2v3a1 1 0 0 0 1 1h1M10.5 2h1a1 1 0 0 1 1 1v3L14 8l-1.5 2v3a1 1 0 0 1-1 1h-1" />
    </StrokeIcon>
  );
}

export function IconCalendarCheck(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M6 10l1.5 1.5L10.5 8.5" />
    </StrokeIcon>
  );
}

export function IconCalendarDownload(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4.5 1.5v3m7-3v3M2 6h12M3.5 3h9A1.5 1.5 0 0 1 14 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3Z" />
      <path d="M8 7.75v4m-1.75-1.5L8 12l1.75-1.75" />
    </StrokeIcon>
  );
}

// ── Brand icons ─────────────────────────────────────────────────────────────

export function IconLinkedIn(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z" />
    </svg>
  );
}

export function IconXTwitter(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.736-8.856L1.254 2.25H8.08l4.257 5.626L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function IconBluesky(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 568 501"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.209C491.866-1.611 568-28.906 568 57.954c0 17.976-10.312 151.124-16.366 172.834-21.009 75.3-97.519 94.434-165.559 82.737C521.813 339.48 540.304 401.245 486.201 463c-105.883 108.893-152.134-27.269-164.013-62.132-5.216-14.818-7.671-21.816-8.188-21.816s-2.972 7-8.188 21.816C293.933 435.731 247.682 571.893 141.799 463c-54.103-61.755-35.612-123.52 99.126-149.475-68.04 11.697-144.55-7.437-165.559-82.737C69.312 209.078 59 75.93 59 57.954 59-28.906 135.134-1.611 123.121 33.664z" />
    </svg>
  );
}

export function IconReddit(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

// ── Text formatting ─────────────────────────────────────────────────────────
//
// The Markdown editor's toolbar (issue 114): one glyph per command, drawn as
// strokes on the same 16px grid, so a row of twelve takes the room a row of
// four words took. Each is decorative — the button around it carries the
// command's name — and inherits the button's ink.

export function IconHeading(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 3v10M12 3v10M4 8h8" />
    </StrokeIcon>
  );
}

export function IconImage(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <circle cx="5.5" cy="5.5" r="1" />
      <path d="m2 12 4-4 3 3 2-2 3 3" />
    </StrokeIcon>
  );
}

export function IconTable(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6h12M2 10h12M7 6v8" />
    </StrokeIcon>
  );
}

export function IconBold(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M5 3h4.25a2.5 2.5 0 0 1 0 5H5zM5 8h5a2.5 2.5 0 0 1 0 5H5z" />
    </StrokeIcon>
  );
}

export function IconItalic(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M7 3h5M4 13h5M10 3l-4 10" />
    </StrokeIcon>
  );
}

export function IconQuote(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 3v10M7 5h6M7 8h6M7 11h4" />
    </StrokeIcon>
  );
}

export function IconCode(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M6 4 2 8l4 4M10 4l4 4-4 4" />
    </StrokeIcon>
  );
}

export function IconBulletList(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
      <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function IconNumberedList(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M7 4h7M7 8h7M7 12h7" />
      <path d="M2.2 3.2 3.4 2.5v4M2.2 8.6a1.2 1.2 0 1 1 2.1.8L2.2 11.5h2.4" />
    </StrokeIcon>
  );
}

export function IconUndo(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 6h7a3 3 0 0 1 0 6H6M5.5 3.5 3 6l2.5 2.5" />
    </StrokeIcon>
  );
}

export function IconRedo(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M13 6H6a3 3 0 0 0 0 6h4M10.5 3.5 13 6l-2.5 2.5" />
    </StrokeIcon>
  );
}

/** The Markdown source view: the document behind the canvas. */
export function IconSource(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 2h5.5L13 5.5V14H4zM9.5 2v3.5H13M6 8.5h4M6 11h4" />
    </StrokeIcon>
  );
}
