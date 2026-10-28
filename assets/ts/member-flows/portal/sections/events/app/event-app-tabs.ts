/**
 * The event app's navigation: every destination the reader can open inside
 * an event, which of them earn one of the phone's five bottom tabs, and which
 * are left for the "More" sheet.
 *
 * Desktop keeps the participant page's top tabs (ParticipantEventNavigation);
 * both read the same participation projection and the same scanner rule, so
 * a destination appears in one exactly when it appears in the other. These
 * rules only decide what to offer; every route still authorizes itself.
 */
import type { z } from "zod";
import type { eventScannerAccessSchema } from "../../../../../../shared/schemas/event-management";
import type { EventParticipation } from "../../../../../../shared/schemas/event-participation";
import { eventAgendaRoute, eventVirtualRoomRoute } from "../../../../../../shared/event-participation-link";
import type { AppIcon } from "../../../../../components/icons/app-navigation";
import { usePortalHashLocation } from "../../../hash-location";
import type { AppTab } from "../../../shell/AppTabBar";
import type { PortalSession } from "../../../types";
import { canOpenGroupWorkspace } from "../event-destination";
import { eventParticipantRecordPath } from "../event-participant-paths";
import { eventRegistrationStanding, eventVenueLines, type ParticipantEventDetail } from "./event-app-model";
import { participantScannerAccess } from "./participant-scanner-access";
import { eventPhase } from "./event-timing";
import { attendanceStanding } from "../../../../../shared/viewer-attendance";

type ScannerAccess = z.infer<typeof eventScannerAccessSchema>;

/** What the navigation needs to know about an event and the reader's standing in it. */
export interface EventAppSubject {
  id: string;
  slug: string;
  participation?: EventParticipation;
  /** The audience projection's own standing; the management projection has none. */
  viewer?: { registrationStatus: EventParticipation["registrationStatus"] } | null;
  scannerAccess?: ScannerAccess;
  /** The public event page, when the event has one. */
  basePath?: string | null;
  /** The owning group, on the management projection only. */
  ownerGroupId?: string | null;
  /** Whether the event has venue details or links for the More page to show. */
  hasDetails?: boolean;
  /** Whether the reader holds an in-person place; false for someone joining only online or still waiting. */
  inPerson?: boolean;
  /** When the event runs; attendees check in only while it does. */
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface EventAppDestination {
  id: string;
  label: string;
  href: string;
  icon: AppIcon;
  /** The shorter name it takes when it earns a bottom tab. */
  tabLabel?: string;
}

const href = usePortalHashLocation.hrefs;

/** The navigation's view of the participant page's event projection. */
export function participantEventAppSubject(event: ParticipantEventDetail): EventAppSubject {
  return {
    ...event,
    ownerGroupId: "ownerGroupId" in event ? event.ownerGroupId : null,
    hasDetails: eventVenueLines(event).length > 0 || event.links.length > 0,
    inPerson: "viewer" in event && event.viewer ? attendanceStanding(event.viewer).holdsInPersonSeat : undefined,
  };
}

function eventBase(slug: string) {
  return `/events/${encodeURIComponent(slug)}`;
}

export function hasEventProposals(event: Pick<EventAppSubject, "participation">): boolean {
  return Boolean(event.participation?.proposals || event.participation?.speakerProposals);
}

/** Personal promotion is offered to speakers and confirmed attendees in every navigation surface. */
export function hasEventPromotionMaterials(event: Pick<EventAppSubject, "participation" | "viewer">): boolean {
  return hasEventProposals(event) || eventRegistrationStanding(event).status === "registered";
}

/**
 * Every destination this reader may open for the event besides Home and
 * Agenda, in the order the More sheet lists them. Each appears only when the
 * same rule that guards its route lets the reader in.
 */
export function eventAppDestinations(event: EventAppSubject, session: PortalSession | null): EventAppDestination[] {
  const base = eventBase(event.slug);
  const standing = eventRegistrationStanding(event);
  const scanners = participantScannerAccess(event.id, event.scannerAccess);
  const myAgenda = eventAgendaRoute(event.slug, { mine: true });
  const destinations: EventAppDestination[] =
    standing.status === "registered"
      ? [{ id: "agenda", label: "My agenda", href: href(myAgenda), icon: "my-agenda" }]
      : [];
  // On event days an attendee with an in-person place scans check-in codes at the venue and its rooms.
  if (standing.registered && event.inPerson !== false && eventPhase(event.startsAt, event.endsAt).kind === "live")
    destinations.push({
      id: "check-in",
      label: "Check in",
      tabLabel: "Scan",
      href: href(base + "/check-in"),
      icon: "scan",
    });
  if (standing.registered)
    destinations.push({ id: "ticket", label: "Ticket", href: href(base + "/ticket"), icon: "ticket" });
  if (scanners.canScan)
    destinations.push({
      id: "scanner",
      label: "Badge scanner",
      tabLabel: "Scan",
      href: href(base + "/scanner"),
      icon: "scan",
    });
  if (scanners.sponsors.length)
    destinations.push({
      id: "lead-scanner",
      label: "Lead scanner",
      tabLabel: "Leads",
      // One sponsor opens its scanner directly; several are chosen between explicitly.
      href: href(
        scanners.sponsors.length === 1
          ? `${base}/sponsors/${encodeURIComponent(scanners.sponsors[0]!.id)}/scanner`
          : base + "/lead-scanner",
      ),
      icon: "leads",
    });
  if (standing.registrationId)
    destinations.push({
      id: "registration",
      label: "Registration",
      href: href(eventParticipantRecordPath(event.slug, "registration", standing.registrationId)),
      icon: "registration",
    });
  // Every registered attendee may watch the live streams; the room itself says when none is on.
  if (standing.registered)
    destinations.push({
      id: "virtual",
      label: "Virtual room",
      href: href(eventVirtualRoomRoute(event.slug)),
      icon: "virtual-room",
    });
  if (standing.status === "registered")
    destinations.push({
      id: "calendar",
      label: "Calendar and reminders",
      href: href(`${myAgenda}&view=calendar`),
      icon: "notifications",
    });
  if (hasEventProposals(event))
    destinations.push(
      { id: "proposals", label: "Proposals", href: href(base + "/submissions"), icon: "proposals" },
      { id: "session-management", label: "My sessions", href: href(base + "/session-management"), icon: "sessions" },
    );
  if (hasEventPromotionMaterials(event))
    destinations.push({ id: "promotion", label: "Share", href: href(base + "/promotion"), icon: "promotion" });
  if (event.hasDetails)
    destinations.push({ id: "venue", label: "Venue & links", href: href(base + "/more"), icon: "venue" });
  if (event.basePath)
    destinations.push({ id: "event-page", label: "Event website", href: event.basePath, icon: "website" });
  if (event.ownerGroupId && canOpenGroupWorkspace(session, event.ownerGroupId))
    destinations.push({
      id: "workspace",
      label: "Organizer workspace",
      href: href(`/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}`),
      icon: "workspace",
    });
  return destinations;
}

export interface EventAppNavigation {
  /** The bottom tabs before More; More itself opens the sheet. */
  tabs: AppTab[];
  /** Everything without a bottom tab, for the More sheet and page. */
  more: EventAppDestination[];
}

/**
 * At most five bottom tabs: Home and Agenda; then the reader's most pressing
 * job — the badge scanner for this event's own staff, otherwise the lead
 * scanner for a sponsor's representative, otherwise check-in for an
 * attendee on an event day, otherwise My agenda; then the
 * ticket for a registered reader, or My agenda when the scanner took its
 * place; then More. Whatever loses its tab stays one swipe away in More.
 */
export function eventAppNavigation(event: EventAppSubject, session: PortalSession | null): EventAppNavigation {
  const destinations = eventAppDestinations(event, session);
  const find = (id: string) => destinations.find((destination) => destination.id === id);
  const primary = find("scanner") ?? find("lead-scanner") ?? find("check-in") ?? find("agenda");
  const secondary = find("ticket") ?? (primary?.id === "agenda" ? undefined : find("agenda"));
  const promoted = [primary, secondary].filter((destination): destination is EventAppDestination =>
    Boolean(destination),
  );
  const base = eventBase(event.slug);
  return {
    tabs: [
      { id: "home", label: "Home", href: href(base), icon: "home" },
      { id: "program", label: "Agenda", href: href(eventAgendaRoute(event.slug)), icon: "agenda" },
      ...promoted.map(({ id, label, tabLabel, href: target, icon }) => ({
        id,
        label: tabLabel ?? label,
        href: target,
        icon,
      })),
    ],
    more: destinations.filter((destination) => !promoted.includes(destination)),
  };
}

/** Which bottom tab owns a participant page; everything without a tab lives under More. */
export function eventAppTabFor(active: string, tabs: readonly AppTab[]): string {
  if (active === "overview") return "home";
  return tabs.some((tab) => tab.id === active) ? active : "more";
}
