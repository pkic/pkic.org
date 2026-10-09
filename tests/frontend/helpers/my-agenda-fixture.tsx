import { render } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import {
  personalAgendaProgramResponseSchema,
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../../assets/shared/schemas/event-personal-agenda";
import { agendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda";
import { MyAgenda } from "../../../assets/ts/member-flows/portal/sections/events/detail/participation/MyAgenda";

/** One synthetic workshop agenda shared by the My agenda revision and shared-agenda suites. */
export const SESSION = "10000000-0000-4000-8000-000000000001";
export const OLD_ROOM = "10000000-0000-4000-8000-000000000002";
export const NEW_ROOM = "10000000-0000-4000-8000-000000000003";
export function session(revision: number, bookingAction: "reserve" | "request") {
  const roomId = revision === 1 ? OLD_ROOM : NEW_ROOM;
  return personalAgendaSessionSchema.parse({
    id: SESSION,
    publishedRevision: revision,
    title: revision === 1 ? "Original workshop" : "Revised workshop",
    roomId: null,
    rooms: [{ id: roomId, name: revision === 1 ? "Original room" : "Revised room" }],
    timeZone: "UTC",
    startAt: revision === 1 ? "2027-01-20T09:00:00.000Z" : "2027-01-20T11:00:00.000Z",
    endAt: revision === 1 ? "2027-01-20T10:00:00.000Z" : "2027-01-20T12:00:00.000Z",
    admissionPolicy: bookingAction === "reserve" ? "reservation" : "approval",
    status: null,
    attendanceMode: "physical",
    availability: [
      {
        attendanceMode: "physical",
        roomId,
        state: "available",
        message: "A place is available.",
        bookingAction,
        canSave: true,
      },
    ],
  });
}
export function listing(revision: number, action: "reserve" | "request", empty = false) {
  return personalAgendaResponseSchema.parse({
    sessions: empty ? [] : [session(revision, action)],
    page: { limit: 50, offset: 0, total: empty ? 0 : 1, hasMore: false },
  });
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
const hosts: HTMLElement[] = [];
export function mount(props: { mine?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<MyAgenda slug="workshop" {...props} />, host));
  return host;
}
let program: unknown = { agenda: null, marks: [] };
/** The published program the next program read returns. */
export function setProgram(next: unknown) {
  program = next;
}
/** Every MyAgenda reads the published program first; tests below focus on the participation endpoints. */
export function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input), location.origin).pathname.endsWith("/agenda/participation/program")
      ? json(personalAgendaProgramResponseSchema.parse(program))
      : handler(input, init),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

/** Shared per-test state: a deep link to the workshop session and no published program. */
export function resetMyAgendaFixture() {
  program = { agenda: null, marks: [] };
  history.replaceState(null, "", `#/events/workshop/agenda?session=${SESSION}`);
}
export function cleanupMyAgendaFixture() {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

export const OPEN = "10000000-0000-4000-8000-000000000004";
export const WAITLIST = "10000000-0000-4000-8000-000000000005";
export function publishedProgram(marks: unknown[]) {
  return {
    agenda: agendaSnapshotSchema.parse({
      eventSlug: "workshop",
      timeZone: "UTC",
      revision: 1,
      publishedRevision: 1,
      approvedAt: "2027-01-01T00:00:00.000Z",
      rooms: [{ id: OLD_ROOM, name: "Original room", capacity: 30 }],
      shifts: [],
      assignments: [],
      roleMembers: [],
      occurrences: [
        {
          id: SESSION,
          title: "Original workshop",
          description: "Hands-on workshop.",
          startAt: "2027-01-20T09:00:00.000Z",
          endAt: "2027-01-20T10:00:00.000Z",
          roomId: OLD_ROOM,
          admissionPolicy: "reservation",
          speakers: [],
        },
        {
          id: OPEN,
          title: "Open keynote",
          description: "Everyone is welcome.",
          startAt: "2027-01-20T11:00:00.000Z",
          endAt: "2027-01-20T12:00:00.000Z",
          roomId: OLD_ROOM,
          admissionPolicy: "preference",
          speakers: [],
        },
        {
          id: WAITLIST,
          title: "Popular lab",
          description: "Limited seats.",
          startAt: "2027-01-20T13:00:00.000Z",
          endAt: "2027-01-20T14:00:00.000Z",
          roomId: OLD_ROOM,
          admissionPolicy: "reservation",
          speakers: [],
        },
      ],
    }),
    marks,
  };
}
/** The shared agenda initializer and native modal dialogs, which jsdom does not implement. */
export function stubSessionDialogs() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.adoptedStyleSheets = [];
  const opened: HTMLDialogElement[] = [];
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      opened.push(this);
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  return opened;
}
export const card = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`.pk-content-agenda__session[data-agenda-occurrence="${id}"]`)!;
export const starOf = (host: HTMLElement, title: string) =>
  card(
    host,
    { "Original workshop": SESSION, "Open keynote": OPEN, "Popular lab": WAITLIST }[title]!,
  ).querySelector<HTMLButtonElement>(`.pk-content-agenda__card-footer button[aria-label="Star ${title}"]`)!;
