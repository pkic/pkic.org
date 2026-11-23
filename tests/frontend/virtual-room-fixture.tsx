import { act } from "preact/test-utils";
import { vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { virtualRoomResponseSchema } from "../../assets/shared/schemas/event-live-stream";
import { personalAgendaProgramResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { sponsorsDisplayResponseSchema } from "../../assets/shared/schemas/public-sponsors";
import { FakeLiveSocket, liveLocationChatSnapshot, liveSnapshot } from "./helpers/live-room-socket";

/** The virtual room's summit: its locations, sessions, streams and sponsors, and the browser stand-ins its tests share. */
export const HALL = "a0000000-0000-4000-8000-000000000001";
export const STUDIO = "a0000000-0000-4000-8000-000000000002";
export const BREAKOUT = "a0000000-0000-4000-8000-000000000003";
export const ROUNDTABLE = "b0000000-0000-4000-8000-000000000004";
export const KEYNOTE = "b0000000-0000-4000-8000-000000000001";
export const PANEL = "b0000000-0000-4000-8000-000000000002";
export const WORKSHOP = "b0000000-0000-4000-8000-000000000003";
export const HALL_STREAM = "jfKfPfyJRdk";
export const STUDIO_STREAM = "o-1sSF_xP5Q";

export function occurrence(id: string, title: string, roomId: string, startAt: string, endAt: string, speaker: string) {
  return {
    id,
    title,
    roomId,
    startAt,
    endAt,
    description: "",
    speakers: [{ userId: `${id}-speaker`, displayName: speaker }],
  };
}

export const program = personalAgendaProgramResponseSchema.parse({
  agenda: agendaSnapshotSchema.parse({
    eventSlug: "summit",
    timeZone: "UTC",
    revision: 4,
    publishedRevision: 4,
    rooms: [
      { id: HALL, name: "Main hall", capacity: null },
      { id: STUDIO, name: "Studio", capacity: null },
    ],
    occurrences: [
      occurrence(KEYNOTE, "Opening keynote", HALL, "2027-01-20T09:00:00.000Z", "2027-01-20T10:00:00.000Z", "Ada"),
      occurrence(PANEL, "Migration panel", HALL, "2027-01-20T10:00:00.000Z", "2027-01-20T11:00:00.000Z", "Grace"),
      occurrence(WORKSHOP, "Hands-on lab", STUDIO, "2027-01-20T09:00:00.000Z", "2027-01-20T11:00:00.000Z", "Linus"),
    ],
    shifts: [],
    roleMembers: [],
    assignments: [],
  }),
  marks: [],
});
export const streams = virtualRoomResponseSchema.parse({
  timeZone: "UTC",
  locations: [
    { id: HALL, name: "Main hall", stream: { provider: "youtube", videoId: HALL_STREAM }, days: [] },
    { id: STUDIO, name: "Studio", stream: { provider: "youtube", videoId: STUDIO_STREAM }, days: [] },
  ],
  productionPartners: [
    {
      role: "Camera Technology Provider",
      organizationId: "30000000-0000-4000-8000-000000000001",
      name: "Northlight",
      website: "https://northlight.example.test/",
      logoUrl: "/api/v1/members/30000000-0000-4000-8000-000000000001/logo?v=1",
    },
  ],
});
export const sponsors = sponsorsDisplayResponseSchema.parse({
  groups: [
    {
      weight: 5,
      tierName: "Gold",
      sponsors: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          name: "Example Trust",
          website: "https://trust.example.test/",
          logoUrl: "/assets/sponsor.svg",
          tier: null,
          eventTier: "Gold",
          effectiveTier: "Gold",
          weight: 5,
        },
      ],
    },
  ],
  page: { limit: 200, offset: 0, total: 1, hasMore: false },
});

export function onDesktop() {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: true,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // jsdom lays nothing out, so the stream never scrolls away and never docks.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

/** The rooms the virtual room connects to, and a way to answer as the latest one would. */
export function fakeRoomSockets() {
  const sockets: FakeLiveSocket[] = [];
  vi.stubGlobal(
    "WebSocket",
    class extends FakeLiveSocket {
      static OPEN = 1;
      constructor(url: string, protocols: string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    },
  );
  // A session's room and the location's chat speak on sockets of their own.
  const rooms = () => sockets.filter((socket) => socket.url.includes("/occurrences/"));
  const chats = () => sockets.filter((socket) => socket.url.endsWith("/live/chat"));
  const roomOn = () => new URL(rooms().at(-1)!.url).pathname.split("/").at(-2);
  const answer = async (opening: "scheduled" | "open" | "closed") => {
    const id = roomOn()!;
    const session = program.agenda!.occurrences.find((item) => item.id === id)!;
    await act(async () => {
      rooms().at(-1)!.open();
      rooms()
        .at(-1)!
        .deliver(
          liveSnapshot({
            opening,
            session: { ...liveSnapshot().session, occurrenceId: id, startAt: session.startAt!, endAt: session.endAt! },
          }),
        );
    });
  };
  /** The main hall's chat answers for its day: the keynote, then the panel. */
  const answerChat = async (opening: "scheduled" | "open" | "closed") => {
    const sessions = program.agenda!.occurrences.filter((item) => item.roomId === HALL);
    await act(async () => {
      chats().at(-1)!.open();
      chats()
        .at(-1)!
        .deliver(
          liveLocationChatSnapshot({
            opening,
            scope: {
              eventName: "Summit",
              roomId: HALL,
              day: "2027-01-20",
              timeZone: "UTC",
              sessions: sessions.map((item) => ({
                occurrenceId: item.id,
                title: item.title,
                startAt: item.startAt!,
                endAt: item.endAt!,
              })),
            },
          }),
        );
    });
  };
  return { sockets, rooms, chats, roomOn, answer, answerChat };
}
