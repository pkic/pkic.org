/**
 * The event app's virtual room: its layout for a desktop and for a phone, the sponsors' line under the
 * stream, the production partners' credit, and the settings that name the partners.
 */
import type { SponsorsDisplayResponse } from "../../../shared/schemas/public-sponsors";
import { useState } from "preact/hooks";
import type { EventProductionPartnerCredit } from "../../../shared/schemas/event-production-partners";
import {
  ProductionPartnerEditor,
  type ProductionPartnerDraft,
} from "../../member-flows/portal/sections/events/detail/settings/ProductionPartnerEditor";
import { ProductionPartnersPanel } from "../../member-flows/portal/sections/events/detail/settings/ProductionPartnersSettings";
import { Button } from "../Button";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { LiveReactionBar } from "../../live-session/LiveReactionBar";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  ROOM_WIDE_QUERY,
  VirtualRoomFrame,
  type RoomPanelId,
} from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomFrame";
import { LiveChatClosed } from "../../live-session/LiveChat";
import { LiveAttendeeChat } from "../../live-session/LocationChat";
import type { LiveLocationChatConnection } from "../../live-session/useLocationChat";
import { LiveAttendeeQuestions, LiveQuestionsClosed } from "../../live-session/SessionQuestions";
import type { LiveRoomConnection } from "../../live-session/useLiveRoom";
import {
  VirtualRoomNowPlaying,
  VirtualRoomPlayer,
} from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomPlayer";
import type { RoomMoment } from "../../member-flows/portal/sections/events/app/virtual-room/virtual-room-schedule";
import { VirtualRoomPartners } from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomPartners";
import { VirtualRoomSponsors } from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomSponsors";
import "../../member-flows/portal/sections/events/app/EventApp.css";
import "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoom.css";
import { AgendaExample } from "./agenda-example";
import { STUDIO_QUESTIONS_ROOM } from "./sections-studio-questions";
import type { PreviewSection } from "./PreviewShell";

/** A wordmark on a light page, as a sponsor supplies it: wide or narrow by the length of the name. */
const wordmark = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${name.length * 22 + 20} 48"><text x="10" y="34" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#1c2530">${name}</text></svg>`,
  )}`;

/** A consortium's spread of sponsors: one at the top, a few under it, most in the tiers below. */
const TIERS: ReadonlyArray<[weight: number, tier: string, names: readonly string[]]> = [
  [6, "Diamond", ["Northwind"]],
  [5, "Titanium", ["Aster", "Borealis", "Cobalt", "Delta Trust"]],
  [4, "Platinum", ["Ember", "Fathom", "Granite", "Harbor", "Indigo", "Juniper", "Keystone", "Lumen", "Meridian"]],
  [3, "Gold", ["Nimbus", "Orchard", "Pinnacle", "Quarry", "Ridge", "Summit"]],
  [2, "Silver", ["Tidal", "Umbra", "Vertex", "Willow", "Zenith"]],
  [1, "Bronze", ["Acorn"]],
];
let serial = 0;
// Drawn marks stand in for uploaded logos here, so the fixture is typed, not parsed as a server response.
const SPONSORS: SponsorsDisplayResponse = {
  groups: TIERS.map(([weight, tierName, names]) => ({
    weight,
    tierName,
    sponsors: names.map((name) => {
      serial += 1;
      return {
        id: `c0000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
        name,
        website: `https://${name.toLowerCase().replaceAll(" ", "-")}.example.test/`,
        logoUrl: wordmark(name),
        tier: tierName,
        eventTier: null,
        effectiveTier: tierName,
        weight,
      };
    }),
  })),
  page: { limit: 200, offset: 0, total: 26, hasMore: false },
};

const PARTNERS: EventProductionPartnerCredit[] = [
  {
    role: "Camera Technology Provider",
    organizationId: "00000000-0000-4000-8000-0000000000a1",
    name: "Northlight Cameras",
    website: "https://northlight.example.test/",
    logoUrl: wordmark("Northlight"),
  },
  {
    role: "Captioning",
    organizationId: "00000000-0000-4000-8000-0000000000a2",
    name: "Clearline",
    website: null,
    logoUrl: null,
  },
];

/** The partner rows as an organizer edits them, with the second row not yet filled in. */
function PartnerEditorSpecimen() {
  const [partners, setPartners] = useState<ProductionPartnerDraft[]>([
    { role: PARTNERS[0]!.role, organizationId: PARTNERS[0]!.organizationId, name: PARTNERS[0]!.name },
    { role: "", organizationId: "", name: "" },
  ]);
  return (
    <Panel aria-label="Production partners">
      <PanelHeader title="Production partners">
        <Button>Cancel</Button>
        <Button variant="primary">Save partners</Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <ProductionPartnerEditor
          partners={partners}
          fieldFor={() => ({})}
          onChange={setPartners}
          loadOrganizations={async (_url, _signal, schema) =>
            schema.parse({ organizations: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })
          }
        />
      </PanelBody>
    </Panel>
  );
}

const session = (id: string, title: string, startAt: string, endAt: string, speaker: string) => ({
  id: `d0000000-0000-4000-8000-00000000000${id}`,
  title,
  startAt,
  endAt,
  speakers: [{ userId: `e0000000-0000-4000-8000-00000000000${id}`, displayName: speaker }],
});
// Between sessions, so the questions and the chat show how they wait and nothing connects to a room.
const MOMENT = {
  current: null,
  upcoming: [
    session("1", "Planning the post-quantum migration", "2027-01-20T09:00:00.000Z", "2027-01-20T09:45:00.000Z", "Ada"),
    session("2", "Hybrid certificates in practice", "2027-01-20T10:00:00.000Z", "2027-01-20T10:45:00.000Z", "Grace"),
    session("3", "Inventory before you migrate", "2027-01-20T11:00:00.000Z", "2027-01-20T11:30:00.000Z", "Linus"),
  ],
} as RoomMoment;
const LOCATIONS = ["Main hall", "Studio"].map((name, index) => ({ id: `room-${index}`, name, href: "#" }));
const formatTime = () => "10:00 – 10:45";

const ON = STUDIO_QUESTIONS_ROOM.session;
const said = (id: number, authorName: string, text: string, mine = false, before = 0) => ({
  channel: "attendee" as const,
  id: `60000000-0000-4000-8000-00000000000${id}`,
  text,
  authorName,
  mine,
  sentAt: new Date(Date.parse(ON.startAt) - before * 60_000).toISOString(),
  ...(before ? {} : { occurrenceId: ON.occurrenceId }),
});
/** The location's chat as an attendee holds it: a word before the session, then the session under way. */
const CHAT: LiveLocationChatConnection = {
  state: {
    viewer: { role: "attendee", name: "Alex Example" },
    scope: {
      eventName: ON.eventName ?? "PQC Conference",
      roomId: "room-0",
      day: ON.startAt.slice(0, 10),
      timeZone: ON.timeZone,
      sessions: [{ occurrenceId: ON.occurrenceId, title: ON.title, startAt: ON.startAt, endAt: ON.endAt }],
    },
    opening: "scheduled",
    chat: [
      said(1, "Riley Sample", "Good morning, everyone.", false, 5),
      said(2, "Jordan Lee", "Is the **hybrid** profile in the draft already?"),
      said(3, "Alex Example", "Yes, section 4 covers it.", true),
    ],
    refusal: null,
  },
  status: "live",
  admissionRefusal: null,
  serverFault: null,
  send: () => true,
};
/** A session's room as an attendee holds it during the session: questions asked and a chat under way. */
const LIVE: LiveRoomConnection = {
  state: {
    ...STUDIO_QUESTIONS_ROOM,
    viewer: { role: "attendee", name: "Alex Example" },
    // An attendee sees an open poll's results only once they have answered it.
    polls: STUDIO_QUESTIONS_ROOM.polls.map((poll) =>
      poll.status === "open" ? { ...poll, myAnswer: "TLS endpoints" } : poll,
    ),
    questions: STUDIO_QUESTIONS_ROOM.questions.filter((question) => question.status !== "pending"),
  },
  status: "live",
  admissionRefusal: null,
  serverFault: null,
  send: () => true,
  questionResult: null,
  answerResult: null,
  questionChangeResult: null,
};

/** The whole room, before its session's room opens or during the session, opened on one of a phone's panels. */
function RoomSpecimen({ opensOn, live = false }: { opensOn: RoomPanelId; live?: boolean }) {
  const wide = useMediaQuery(ROOM_WIDE_QUERY);
  const [panel, setPanel] = useState(opensOn);
  const [locationId, setLocationId] = useState(LOCATIONS[0]!.id);
  return (
    <VirtualRoomFrame
      wide={wide}
      locations={LOCATIONS}
      locationId={locationId}
      onLocation={setLocationId}
      player={<VirtualRoomPlayer stream={null} locationName="Main hall" />}
      now={(picker) => (
        <VirtualRoomNowPlaying
          slug="preview"
          moment={MOMENT}
          formatTime={formatTime}
          location={picker}
          reactions={<LiveReactionBar send={() => true} refusal={null} />}
        />
      )}
      sponsors={<VirtualRoomSponsors sponsors={SPONSORS} />}
      partners={<VirtualRoomPartners partners={PARTNERS} />}
      questions={(askIn) =>
        live ? (
          <LiveAttendeeQuestions room={LIVE} occurrenceId={LIVE.state!.session.occurrenceId} askIn={askIn} />
        ) : (
          <LiveQuestionsClosed askIn={askIn} />
        )
      }
      chat={live ? <LiveAttendeeChat chat={CHAT} compact /> : <LiveChatClosed />}
      agenda={<AgendaExample compact />}
      eventHref="#"
      panel={panel}
      panelHref={() => "#"}
      onPanel={setPanel}
    />
  );
}

export const virtualRoomSections: PreviewSection[] = [
  {
    id: "virtual-room",
    title: "Virtual room",
    note: "On a desktop the stream is large on the left with the event's agenda under it; questions and polls sit top right with the chat under them, both always open. On a phone the stream, the running session and the sponsors stay at the top, and the bottom bar switches one panel between questions, chat and the agenda.",
    render: () => <RoomSpecimen opensOn="questions" />,
  },
  {
    id: "virtual-room-live",
    title: "Virtual room: during a session",
    note: "Ask a question is always in view, in the questions' header on a desktop and at the top of the panel on a phone, and opens the form over the list. The chat is a window: the messages scroll and the field stays at its foot.",
    render: () => <RoomSpecimen opensOn="questions" live />,
  },
  {
    id: "virtual-room-agenda",
    title: "Virtual room: the agenda on a phone",
    note: "The Agenda tab holds the event's own agenda, so the whole program is at hand while the stream plays. The production partners are credited at its foot.",
    render: () => <RoomSpecimen opensOn="agenda" />,
  },
  {
    id: "virtual-room-sponsors",
    title: "Virtual room: sponsors under the stream",
    note: "One line of a fixed height, one tier at a time, each tier at its own size and every logo of a tier given the same room. The line changes by itself every few seconds and waits while the pointer or the keyboard is on a logo. On a desktop the highest tier stays at the start of the line; on a phone it takes turns and returns most often. A logo's tier is its tooltip.",
    render: () => <VirtualRoomSponsors sponsors={SPONSORS} />,
  },
  {
    id: "virtual-room-partners",
    title: "Virtual room: production partners",
    note: "Someone who helps produce the stream is credited with what they provide, then their logo, smaller than any sponsor's. They stand apart from the sponsors and never take a turn in the sponsors' line. A partner without a logo is named in words.",
    render: () => <VirtualRoomPartners partners={PARTNERS} />,
  },
  {
    id: "production-partners-settings",
    title: "Event settings: production partners",
    note: "On the event's Studio settings. Each partner reads as what it is credited as and the organization's name; the name, website and logo are the organization's own and are never typed here.",
    render: () => (
      <ProductionPartnersPanel
        event={{ slug: "preview", updatedAt: "2026-11-01T00:00:00.000Z", productionPartners: PARTNERS }}
        canEdit
        onUpdated={() => {}}
      />
    ),
  },
  {
    id: "production-partners-editing",
    title: "Event settings: editing the production partners",
    note: "One row per partner: the credit as free text and the organization from the organization list. An organization is listed once.",
    render: () => <PartnerEditorSpecimen />,
  },
];
