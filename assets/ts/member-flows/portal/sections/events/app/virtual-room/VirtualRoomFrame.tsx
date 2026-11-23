/**
 * The virtual room's layout, with nothing of its own to load.
 *
 * On a desktop the stream is large on the left with the running session, the sponsors, the event's agenda
 * and the production partners under it; questions and polls sit top right with the chat under them, both
 * always open. On a phone it works like an app: the stream, the running session and the sponsors stay at the top,
 * one panel shows beneath them, and a bottom bar switches between questions, chat and the event's agenda.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { IconHelp } from "../../../../../../components/icons";
import { Button } from "../../../../../../ui/Button";
import { IconVirtualOff, StrokeIcon } from "../../../../../../ui/MediaIcons";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TabList } from "../../../../../../ui/TabList";
import { Tabs } from "../../../../../../ui/Tabs";
import { AppTabBar } from "../../../../shell/AppTabBar";
import { useRoomTour, VirtualRoomTour } from "./VirtualRoomTour";

export const ROOM_PANELS = ["questions", "chat", "agenda"] as const;
export type RoomPanelId = (typeof ROOM_PANELS)[number];
/** From this width the room has the stream and both panels side by side. */
export const ROOM_WIDE_QUERY = "(min-width: 64rem)";

const PANEL_LABELS = { questions: "Questions", chat: "Chat", agenda: "Agenda" } as const;
const PANEL_ICONS = { questions: "questions", chat: "chat", agenda: "agenda" } as const;
const CHAT_TITLE = "virtual-room-chat-title";

export interface RoomLocationChoice {
  id: string;
  name: string;
  href: string;
  /** False for a location held in the room only, which its tab marks. */
  streamed?: boolean;
}

export interface VirtualRoomFrameProps {
  wide: boolean;
  /** Something the reader should know before the room, such as a linked session that has not started. */
  notice?: ComponentChildren;
  locations: readonly RoomLocationChoice[];
  locationId: string;
  player: ComponentChildren;
  /** False for a location held in the room only: its banner scrolls away instead of docking beside the questions. */
  streamed?: boolean;
  /** The running session's line, given the room tour's button where the line carries it. */
  now: (tour: ComponentChildren) => ComponentChildren;
  sponsors: ComponentChildren;
  partners: ComponentChildren;
  /** The questions, given the place in their panel's header for the Ask a question button where there is one. */
  questions: (askIn: HTMLElement | null) => ComponentChildren;
  chat: ComponentChildren;
  /** The event's own agenda: under the stream on a desktop, on the Agenda tab of a phone. */
  agenda: ComponentChildren;
  eventHref: string;
  panel: RoomPanelId;
  panelHref: (panel: RoomPanelId) => string;
  onPanel: (panel: RoomPanelId) => void;
  /** The room is in view: on a device's first visit its tour opens by itself. */
  tourOnFirstVisit?: boolean;
}

export function VirtualRoomFrame(props: VirtualRoomFrameProps) {
  return props.wide ? <WideRoom {...props} /> : <NarrowRoom {...props} />;
}

/** The help button that opens the room's tour, and closes it again. */
function TourButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      icon
      variant="ghost"
      aria-label="Room tour"
      aria-expanded={open}
      title={"Room tour\nA short tour of the virtual room."}
      data-tour-trigger
      data-room-tour="help"
      onClick={onToggle}
    >
      <IconHelp />
    </Button>
  );
}

/** The locations as tabs, a tab each, with the room's own controls at the end of the same line. */
function LocationBar({
  locations,
  locationId,
  children,
}: {
  locations: readonly RoomLocationChoice[];
  locationId: string;
  children: ComponentChildren;
}) {
  return (
    <div class="pk-virtual-room__bar">
      {locations.length > 1 ? <Tabs label="Locations" activeId={locationId} items={locations.map(asTab)} /> : <span />}
      <div class="pk-virtual-room__bar-end">{children}</div>
    </div>
  );
}

function WideRoom({
  notice,
  locations,
  locationId,
  player,
  streamed = true,
  now,
  sponsors,
  partners,
  questions,
  chat,
  agenda,
  tourOnFirstVisit = false,
}: VirtualRoomFrameProps) {
  const tour = useRoomTour(tourOnFirstVisit);
  // The Ask a question control sits at the foot of the questions, where the chat keeps its message field.
  const [askIn, setAskIn] = useState<HTMLElement | null>(null);
  const room = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const full = useRoomWindow();
  const docked = useDockedStream(screen, side, streamed && !full.active);
  return (
    <div
      ref={room}
      class={`pk-virtual-room pk-virtual-room--wide${docked ? " pk-virtual-room--docked" : ""}${full.active ? " pk-virtual-room--full" : ""}`}
    >
      {notice}
      <LocationBar locations={locations} locationId={locationId}>
        <TourButton open={tour.open} onToggle={tour.toggle} />
        <Button
          icon
          variant="ghost"
          data-room-tour="full"
          aria-pressed={full.active}
          aria-label={full.active ? "Exit full screen" : "Full screen"}
          title={
            full.active
              ? "Exit full screen\nShow the portal around the room again. Shortcut: Esc."
              : "Full screen\nFill the window with the stream, the questions and the chat."
          }
          onClick={full.toggle}
        >
          <StrokeIcon>
            <path
              d={full.active ? "M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" : "M6 1H1v5M10 1h5v5M6 15H1v-5M10 15h5v-5"}
            />
          </StrokeIcon>
        </Button>
      </LocationBar>
      <div class="pk-virtual-room__main">
        <div class="pk-virtual-room__stage">
          <div ref={screen} class="pk-virtual-room__screen">
            {player}
          </div>
          {now(null)}
          {sponsors}
        </div>
        {full.active ? null : agenda}
        {full.active ? null : partners}
      </div>
      <div ref={side} class="pk-virtual-room__side">
        <Panel class="pk-virtual-room__panel" aria-label="Questions and polls">
          <PanelHeader title="Questions and polls" />
          <PanelBody>{questions(askIn)}</PanelBody>
          <div ref={setAskIn} class="pk-virtual-room__ask" />
        </Panel>
        <Panel class="pk-virtual-room__panel" aria-labelledby={CHAT_TITLE}>
          <PanelHeader id={CHAT_TITLE} title="Chat" />
          <PanelBody>{chat}</PanelBody>
        </Panel>
      </div>
      {tour.open && <VirtualRoomTour scope={room} wide onClose={tour.close} />}
    </div>
  );
}

/**
 * Full screen drawn in the page, as the studio's is: the room covers the portal's navigation and takes the
 * whole window. Escape puts the portal back.
 */
function useRoomWindow() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      setActive(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active]);
  return { active, toggle: () => setActive(!active) };
}

/**
 * Once the stream scrolls out of view, it docks above the questions, where it keeps playing. The player is
 * never moved in the page, so the stream does not reload: it is drawn in the side column's place instead.
 */
function useDockedStream(
  screen: { current: HTMLElement | null },
  side: { current: HTMLElement | null },
  enabled: boolean,
) {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const target = screen.current;
    if (!enabled || !target) return setDocked(false);
    const observer = new IntersectionObserver(
      ([entry]) => setDocked(Boolean(entry && entry.intersectionRatio < 0.35)),
      {
        threshold: [0, 0.35, 1],
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [screen, enabled]);
  useEffect(() => {
    const target = screen.current;
    const column = side.current;
    if (!target || !column) return;
    const place = () => {
      const box = column.getBoundingClientRect();
      const holder = column.parentElement ?? target;
      holder.style.setProperty("--pk-room-dock-left", `${box.left}px`);
      holder.style.setProperty("--pk-room-dock-width", `${box.width}px`);
      if (!docked) holder.style.setProperty("--pk-room-screen-height", `${target.getBoundingClientRect().height}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [screen, side, docked]);
  return docked;
}

function NarrowRoom({
  notice,
  locations,
  locationId,
  player,
  now,
  sponsors,
  partners,
  questions,
  chat,
  agenda,
  eventHref,
  panel,
  panelHref,
  onPanel,
  tourOnFirstVisit = false,
}: VirtualRoomFrameProps) {
  const tour = useRoomTour(tourOnFirstVisit);
  const room = useRef<HTMLDivElement>(null);
  const tab = `virtual-room-tab-${panel}`;
  // Once opened, the agenda stays in the page behind the other panels, so coming back to it is instant.
  const [agendaOpened, setAgendaOpened] = useState(panel === "agenda");
  // On a phone the Ask a question control sits at the panel's foot, where the chat keeps its message field.
  const [askFoot, setAskFoot] = useState<HTMLElement | null>(null);
  if (panel === "agenda" && !agendaOpened) setAgendaOpened(true);
  // Each location is a tab above the stream, as on a desktop; with one location the line under it opens the tour.
  const tourButton = <TourButton open={tour.open} onToggle={tour.toggle} />;
  const located = locations.length > 1;
  return (
    <div ref={room} class="pk-virtual-room">
      {notice}
      <div class="pk-virtual-room__stage">
        {located && (
          <LocationBar locations={locations} locationId={locationId}>
            {tourButton}
          </LocationBar>
        )}
        {player}
        {now(located ? null : tourButton)}
        {sponsors}
      </div>
      {/* Between a phone and a desktop the page has no bottom bar, so the panels keep their own tabs. */}
      <TabList
        class="pk-virtual-room__tabs"
        label="Room panels"
        idPrefix="virtual-room-tab"
        items={ROOM_PANELS.map((id) => ({ id, label: PANEL_LABELS[id], panelId: `virtual-room-${id}` }))}
        activeId={panel}
        onSelect={(id) => onPanel(id as RoomPanelId)}
      />
      {panel !== "agenda" && (
        <div id={`virtual-room-${panel}`} class="pk-virtual-room__panel" role="tabpanel" aria-labelledby={tab}>
          {panel === "questions" ? questions(askFoot) : chat}
        </div>
      )}
      <div ref={setAskFoot} class="pk-virtual-room__ask" hidden={panel !== "questions"} />
      {agendaOpened && (
        <div
          id="virtual-room-agenda"
          class="pk-virtual-room__panel"
          role="tabpanel"
          aria-labelledby="virtual-room-tab-agenda"
          hidden={panel !== "agenda"}
        >
          {agenda}
          {partners}
        </div>
      )}
      <AppTabBar
        scope="event"
        label="Virtual room"
        activeId={panel}
        items={[
          ...ROOM_PANELS.map((id) => ({
            id,
            label: PANEL_LABELS[id],
            icon: PANEL_ICONS[id],
            href: panelHref(id),
            onSelect: () => onPanel(id),
          })),
          { id: "event", label: "Event", icon: "home" as const, href: eventHref },
        ]}
      />
      {tour.open && <VirtualRoomTour scope={room} wide={false} onClose={tour.close} />}
    </div>
  );
}

function asTab(location: RoomLocationChoice) {
  return location.streamed === false
    ? {
        id: location.id,
        label: location.name,
        href: location.href,
        icon: <IconVirtualOff />,
        title: `${location.name}\nNot streamed: questions and chat only.`,
      }
    : { id: location.id, label: location.name, href: location.href };
}
