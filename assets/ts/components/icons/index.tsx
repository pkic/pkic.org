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
import type { ComponentChildren, JSX } from "preact";

type SvgProps = Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">;

// ── UI icons ────────────────────────────────────────────────────────────────

/**
 * The two kinds of member: an organization, and a person in their own right.
 *
 * Named rather than decorative at every call site so far — they stand in for
 * a word rather than repeating one — so the caller passes
 * `aria-hidden={undefined}` with its own `role` and `aria-label`.
 */
export function IconOrganization(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      {/* A block with a door, not a facade of eighteen windows: at 16px the
          detailed one read as noise rather than as a building. */}
      <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h7A1.5 1.5 0 0 1 13 1.5V16h-4v-3.5a1 1 0 0 0-2 0V16H3zM5.5 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm4 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm-4 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm4 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm-4 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm4 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1z" />
    </svg>
  );
}

export function IconIndividual(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z" />
    </svg>
  );
}

export function IconLink(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z" />
      <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z" />
    </svg>
  );
}

export function IconRemove(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708" />
    </svg>
  );
}

export function IconPlus(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4" />
    </svg>
  );
}

/**
 * The pencil that starts an edit.
 *
 * Editing a record is a command taken from its actions menu (#47), and a
 * command a reader takes constantly deserves a second, quieter way in beside
 * the thing it edits (#46) — not a band across the record announcing that it
 * is editable. Decorative: the button around it carries the name.
 */
export function IconPencil(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325" />
    </svg>
  );
}

export function IconCheckmark(props: SvgProps) {
  return (
    <svg
      class="event-flow-consent-indicator-check"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0" />
    </svg>
  );
}

export function IconInfoCircle(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
      <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
    </svg>
  );
}

export function IconExternalLink(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path
        fill-rule="evenodd"
        d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"
      />
      <path
        fill-rule="evenodd"
        d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"
      />
    </svg>
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

// ── Attendance mode icons (path-only, wrapped by consumer in an <svg>) ──────

export function IconInPerson(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path
        fill-rule="evenodd"
        d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
      />
    </svg>
  );
}

export function IconVirtual(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path
        fill-rule="evenodd"
        d="M0 5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.983 1.738l3.11-1.382A1 1 0 0 1 16 4.269v7.462a1 1 0 0 1-1.406.913l-3.111-1.382A2 2 0 0 1 9.5 13H2a2 2 0 0 1-2-2z"
      />
    </svg>
  );
}

export function IconOnDemand(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z" />
    </svg>
  );
}

export function IconCalendarCheck(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 .5a.5.5 0 0 0-1 0V1H2a2 2 0 0 0-2 2v1h16V3a2 2 0 0 0-2-2h-1V.5a.5.5 0 0 0-1 0V1H4zM16 14V5H0v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2m-5.146-5.146-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 0 1 .708-.708L7.5 10.793l2.646-2.647a.5.5 0 0 1 .708.708" />
    </svg>
  );
}

// ── Text formatting ─────────────────────────────────────────────────────────
//
// The Markdown editor's toolbar (issue 114): one glyph per command, drawn as
// strokes on the same 16px grid, so a row of twelve takes the room a row of
// four words took. Each is decorative — the button around it carries the
// command's name — and inherits the button's ink.

function StrokeIcon({ children, ...props }: SvgProps & { children: ComponentChildren }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHeading(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 3v10M12 3v10M4 8h8" />
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
      <path d="M2.2 3.2 3.4 2.5v4M2.2 8.6a1.2 1.2 0 1 1 2.1.8L2.2 11.5h2.4" stroke-width="1.2" />
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

export function IconBraces() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path d="M8 3H6v6l-3 3 3 3v6h2M16 3h2v6l3 3-3 3v6h-2" />
    </svg>
  );
}
export function IconLayers() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}
