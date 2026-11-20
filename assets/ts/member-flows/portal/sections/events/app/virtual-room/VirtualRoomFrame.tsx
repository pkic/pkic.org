/**
 * The virtual room's layout, with nothing of its own to load.
 *
 * On a desktop the stream is large on the left with the running session, the sponsors, "Now & next" and the
 * production partners under it; questions and polls sit top right with the chat under them, both always
 * open. On a phone it works like an app: the stream, the running session and the sponsors stay at the top,
 * one panel shows beneath them, and a bottom bar switches between questions, chat and the event's agenda.
 */
import type { ComponentChildren } from "preact";
import { ExternalLink } from "../../../../../../ui/ExternalLink";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TabList } from "../../../../../../ui/TabList";
import { Tabs } from "../../../../../../ui/Tabs";
import { Select } from "../../../../../../ui/TextControl";
import { AppTabBar } from "../../../../shell/AppTabBar";

export const ROOM_PANELS = ["questions", "chat", "agenda"] as const;
export type RoomPanelId = (typeof ROOM_PANELS)[number];
/** From this width the room has the stream and both panels side by side. */
export const ROOM_WIDE_QUERY = "(min-width: 64rem)";

const PANEL_LABELS = { questions: "Questions", chat: "Chat", agenda: "Agenda" } as const;
const PANEL_ICONS = { questions: "questions", chat: "chat", agenda: "agenda" } as const;
const QUESTIONS_TITLE = "virtual-room-questions-title";
const CHAT_TITLE = "virtual-room-chat-title";

export interface RoomLocationChoice {
  id: string;
  name: string;
  href: string;
}

export interface VirtualRoomFrameProps {
  wide: boolean;
  /** Something the reader should know before the room, such as a linked session that has not started. */
  notice?: ComponentChildren;
  locations: readonly RoomLocationChoice[];
  locationId: string;
  onLocation: (id: string) => void;
  player: ComponentChildren;
  /** The running session's line, given the location picker where the line carries it. */
  now: (location: ComponentChildren) => ComponentChildren;
  sponsors: ComponentChildren;
  partners: ComponentChildren;
  schedule: ComponentChildren;
  questions: ComponentChildren;
  chat: ComponentChildren;
  /** The event's own agenda, shown on a phone's Agenda tab. */
  agenda: ComponentChildren;
  agendaHref: string;
  eventHref: string;
  panel: RoomPanelId;
  panelHref: (panel: RoomPanelId) => string;
  onPanel: (panel: RoomPanelId) => void;
}

export function VirtualRoomFrame(props: VirtualRoomFrameProps) {
  return props.wide ? <WideRoom {...props} /> : <NarrowRoom {...props} />;
}

function WideRoom({
  notice,
  locations,
  locationId,
  player,
  now,
  sponsors,
  partners,
  schedule,
  questions,
  chat,
  agendaHref,
}: VirtualRoomFrameProps) {
  return (
    <div class="pk-virtual-room pk-virtual-room--wide">
      {notice}
      {locations.length > 1 && <Tabs label="Locations" activeId={locationId} items={locations.map(asTab)} />}
      <div class="pk-virtual-room__main">
        <div class="pk-virtual-room__stage">
          {player}
          {now(null)}
          {sponsors}
        </div>
        <Panel>
          <PanelHeader title="Now & next">
            {/* In its own tab, so the stream keeps playing here. */}
            <ExternalLink href={agendaHref} external>
              Full agenda
            </ExternalLink>
          </PanelHeader>
          <PanelBody>{schedule}</PanelBody>
        </Panel>
        {partners}
      </div>
      <div class="pk-virtual-room__side">
        <Panel class="pk-virtual-room__panel" aria-labelledby={QUESTIONS_TITLE}>
          <PanelHeader id={QUESTIONS_TITLE} title="Questions and polls" />
          <PanelBody>{questions}</PanelBody>
        </Panel>
        <Panel class="pk-virtual-room__panel" aria-labelledby={CHAT_TITLE}>
          <PanelHeader id={CHAT_TITLE} title="Chat" />
          <PanelBody>{chat}</PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function NarrowRoom({
  notice,
  locations,
  locationId,
  onLocation,
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
}: VirtualRoomFrameProps) {
  const tab = `virtual-room-tab-${panel}`;
  const picker =
    locations.length > 1 ? (
      <Select
        class="pk-virtual-room__location"
        aria-label="Location"
        value={locationId}
        onChange={(event) => onLocation(event.currentTarget.value)}
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </Select>
    ) : null;
  return (
    <div class="pk-virtual-room">
      {notice}
      <div class="pk-virtual-room__stage">
        {player}
        {now(picker)}
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
      <div id={`virtual-room-${panel}`} class="pk-virtual-room__panel" role="tabpanel" aria-labelledby={tab}>
        {panel === "questions" && questions}
        {panel === "chat" && chat}
        {panel === "agenda" && (
          <>
            {agenda}
            {partners}
          </>
        )}
      </div>
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
    </div>
  );
}

function asTab(location: RoomLocationChoice) {
  return { id: location.id, label: location.name, href: location.href };
}
