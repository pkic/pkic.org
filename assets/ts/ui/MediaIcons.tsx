/**
 * The site-safe icon set.
 *
 * Every UI glyph that a server-rendered site component may draw lives here, so
 * the public pages and the portal share one drawing of each idea; the portal's
 * `components/icons` re-exports these and adds the glyphs only it needs.
 *
 * All of them are outlines on a 16-unit grid drawn through `StrokeIcon`. The
 * line weight is not a number in this file: `StrokeIcon` marks each glyph
 * `pk-icon`, and the base stylesheet draws that class at `--pk-icon-stroke`
 * rendered pixels whatever size the glyph is shown at.
 */
import type { ComponentChildren, JSX } from "preact";

export type SvgProps = Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">;

/** The outline icon frame; the only place an icon's stroke treatment is decided. */
export function StrokeIcon({
  children,
  class: className,
  className: legacyClass,
  ...props
}: SvgProps & { children: ComponentChildren }) {
  const classes = ["pk-icon", className, legacyClass].filter(Boolean).join(" ");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
      class={classes}
    >
      {children}
    </svg>
  );
}

// ── Media ───────────────────────────────────────────────────────────────────

export function IconVideo(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m6 5 5 3-5 3z" />
    </StrokeIcon>
  );
}

export function IconRemote(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2" width="12" height="9" rx="1" />
      <path d="M8 11v3M5 14h6" />
    </StrokeIcon>
  );
}

/** A video camera: attending online. */
export function IconVirtual(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
      <path d="m10.5 7 4-2v6l-4-2" />
    </StrokeIcon>
  );
}

/** A play button in a circle: watching later, on demand. */
export function IconOnDemand(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="m6.5 5.5 4 2.5-4 2.5z" />
    </StrokeIcon>
  );
}

export function IconDownload(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 1.5v9m-3-3 3 3 3-3M2 10.5v3h12v-3" />
    </StrokeIcon>
  );
}

// ── Commands ────────────────────────────────────────────────────────────────

/** A funnel for the control that shows or hides agenda filters. */
export function IconFilter(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 3h12L9.5 8.5V13l-3 1.5v-6z" />
    </StrokeIcon>
  );
}

/** The filter funnel struck through: clears every active filter. */
export function IconFilterOff(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 3h12L9.5 8.5V13l-3 1.5v-6zM2 1l12 14" />
    </StrokeIcon>
  );
}

export function IconSearch(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </StrokeIcon>
  );
}

/** A cross: close, remove, reject. */
export function IconRemove(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </StrokeIcon>
  );
}

export function IconPencil(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m3 11 8-8 2 2-8 8-3 1 1-3ZM10 4l2 2" />
    </StrokeIcon>
  );
}

export function IconLink(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" />
    </StrokeIcon>
  );
}

export function IconExternalLink(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 9v3.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4H7M10 2h4v4M7 9l7-7" />
    </StrokeIcon>
  );
}

export function IconMenu(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </StrokeIcon>
  );
}

const CHEVRON_PATHS = {
  up: "m3 10.5 5-5 5 5",
  down: "m3 5.5 5 5 5-5",
  left: "m10.5 3-5 5 5 5",
  right: "m5.5 3 5 5-5 5",
} as const;

/** A chevron pointing where the control leads: a disclosure, a scroll or a pager step. */
export function IconChevron({ pointing, ...props }: SvgProps & { pointing: keyof typeof CHEVRON_PATHS }) {
  return (
    <StrokeIcon {...props}>
      <path d={CHEVRON_PATHS[pointing]} />
    </StrokeIcon>
  );
}

// ── Places, time and people ─────────────────────────────────────────────────

/** A venue or location; shared by the portal's app tiles and the public event cards. */
export function IconMapPin(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" />
      <circle cx="8" cy="6.5" r="1.6" />
    </StrokeIcon>
  );
}

export function IconCalendar(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </StrokeIcon>
  );
}

export function IconClock(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
    </StrokeIcon>
  );
}

/** One star outline; a saved preference fills it. */
export const STAR_PATH = "m8 1.5 2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.9l-4 2.1.8-4.5-3.3-3.2 4.5-.7z";

export function IconStar(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d={STAR_PATH} />
    </StrokeIcon>
  );
}

export function IconPeople(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="6" cy="5.5" r="2.3" />
      <path d="M1.8 13.5c.4-2.4 2-3.7 4.2-3.7s3.8 1.3 4.2 3.7z" />
      <path d="M10.6 3.4a2.3 2.3 0 0 1 0 4.4M12 9.9c1.3.4 2 1.6 2.2 3.6h-2" />
    </StrokeIcon>
  );
}

export function IconFlag(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 14.5V2M3 2.5h9l-2 3 2 3H3" />
    </StrokeIcon>
  );
}

// ── Session formats ─────────────────────────────────────────────────────────

/** A screen on a stand: a talk, and the sessions the reader speaks in. */
export function IconPresentation(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="1.8" y="2.5" width="12.4" height="8" rx="1" />
      <path d="M8 10.5V13M5.5 14h5" />
    </StrokeIcon>
  );
}

/** A wrench and a screwdriver: a hands-on workshop or tutorial. */
export function IconTools(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m2 2 3 1 8 10-2 1L3 4 2 2ZM10 2a3 3 0 0 0-2 4l-6 6 2 2 6-6a3 3 0 0 0 4-3l-2 2-3-3 2-2Z" />
    </StrokeIcon>
  );
}

export function IconBolt(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />
    </StrokeIcon>
  );
}

/** A table with places around it. */
export function IconRoundtable(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.8v.1M8 14.1v.1M1.8 8h.1M14.1 8h.1" />
    </StrokeIcon>
  );
}

/** A screen playing something: a live demonstration. */
export function IconDemo(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 3h12v8H2zM6 14h4M8 11v3M6.5 5.5v3l2.5-1.5z" />
    </StrokeIcon>
  );
}

/** The glyph for each configured session format; unknown formats use the talk glyph. */
export const SESSION_FORMAT_ICONS: Readonly<Record<string, (props: SvgProps) => JSX.Element>> = {
  talk: IconPresentation,
  keynote: IconStar,
  panel: IconPeople,
  lightning_talk: IconBolt,
  workshop: IconTools,
  tutorial: IconTools,
  roundtable: IconRoundtable,
  demo: IconDemo,
  opening: IconFlag,
  closing: IconFlag,
};

export function SessionFormatIcon({ format, ...props }: SvgProps & { format: string }) {
  const Icon = SESSION_FORMAT_ICONS[format] ?? IconPresentation;
  return <Icon {...props} />;
}

// ── Theme ───────────────────────────────────────────────────────────────────

export function IconMonitor(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 13.5h5" />
    </StrokeIcon>
  );
}

export function IconSun(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
    </StrokeIcon>
  );
}

export function IconMoon(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" />
    </StrokeIcon>
  );
}
