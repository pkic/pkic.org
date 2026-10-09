/**
 * App navigation icons: the glyphs of the installed portal's bottom tab bar
 * and of the event app's destination tiles.
 *
 * Outline glyphs on the shared 16px grid, drawn at the one icon weight. The
 * bottom tab bar marks the open tab by filling them and drawing them at the
 * strong weight, so each closes its shapes.
 * Every glyph is decorative: the tab or tile label beside it is the name.
 */
import type { JSX } from "preact";
import { IconCalendar, IconMapPin, IconPeople, IconPresentation, IconStar, StrokeIcon } from "../../ui/MediaIcons";

export { IconCalendar, IconPeople, IconPresentation, IconStar };

type SvgProps = Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">;

export function IconHome(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2.5 7.2 8 2.5l5.5 4.7v6.3h-3.7V10H6.2v3.5H2.5z" />
    </StrokeIcon>
  );
}

export function IconTicket(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 4.5h12v2.2a1.5 1.5 0 0 0 0 2.6v2.2H2V9.3a1.5 1.5 0 0 0 0-2.6z" />
      <path d="M10 4.5v7" stroke-dasharray="1.2 1.4" />
    </StrokeIcon>
  );
}

export function IconMore(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </StrokeIcon>
  );
}

export function IconPerson(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="5" r="2.7" />
      <path d="M3 14c.4-2.9 2.3-4.4 5-4.4s4.6 1.5 5 4.4z" />
    </StrokeIcon>
  );
}

/** A code inside a viewfinder: the badge and check-in scanner. */
export function IconScan(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 5.5v-2A1.5 1.5 0 0 1 3.5 2h2M10.5 2h2A1.5 1.5 0 0 1 14 3.5v2M14 10.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 14h-2A1.5 1.5 0 0 1 2 12.5v-2" />
      <rect x="5" y="5" width="2.5" height="2.5" />
      <rect x="8.5" y="8.5" width="2.5" height="2.5" />
      <path d="M8.5 5H11v2.5M5 8.5V11h2.5" />
    </StrokeIcon>
  );
}

/** A contact card: a sponsor's captured lead. */
export function IconLeadCard(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <circle cx="5.5" cy="7" r="1.5" />
      <path d="M3.5 11c.3-1.2 1.1-1.8 2-1.8s1.7.6 2 1.8z" />
      <path d="M9.5 6.5h3M9.5 9h3" />
    </StrokeIcon>
  );
}

/** A filled-in form: the reader's own registration. */
export function IconClipboard(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="3" y="2.5" width="10" height="11.5" rx="1.5" />
      <path d="M6 1.8h4v2H6z" />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
    </StrokeIcon>
  );
}

/** A written page: a submitted proposal. */
export function IconDocument(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
      <path d="M9 1.8V5h3.5M6 8h4.5M6 10.5h4.5" />
    </StrokeIcon>
  );
}

export function IconMegaphone(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2.5 6.5H5l6-3v9l-6-3H2.5z" />
      <path d="m5 9.5 1 3.5h1.8M13 6.5v3" />
    </StrokeIcon>
  );
}

/** Reminders and alerts; shown with the calendar subscription. */
export function IconBell(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8z" />
      <path d="M6.5 14.2a1.6 1.6 0 0 0 3 0" />
    </StrokeIcon>
  );
}

/** The public website, outside the portal. */
export function IconGlobe(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6S9.8 12.2 8 14c-1.8-1.8-2.6-3.8-2.6-6S6.2 3.8 8 2z" />
    </StrokeIcon>
  );
}

/** Controls: the organizers' workspace for the event. */
export function IconSliders(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
      <circle cx="5.5" cy="4" r="1.4" />
      <circle cx="10.5" cy="8" r="1.4" />
      <circle cx="6.5" cy="12" r="1.4" />
    </StrokeIcon>
  );
}

/** Every navigation glyph by the name a tab or destination asks for. */
export const APP_ICONS = {
  home: IconHome,
  events: IconCalendar,
  groups: IconPeople,
  me: IconPerson,
  agenda: IconCalendar,
  "my-agenda": IconStar,
  ticket: IconTicket,
  more: IconMore,
  scan: IconScan,
  leads: IconLeadCard,
  registration: IconClipboard,
  proposals: IconDocument,
  sessions: IconPresentation,
  promotion: IconMegaphone,
  notifications: IconBell,
  venue: IconMapPin,
  website: IconGlobe,
  workspace: IconSliders,
} satisfies Record<string, (props: SvgProps) => JSX.Element>;

export type AppIcon = keyof typeof APP_ICONS;
