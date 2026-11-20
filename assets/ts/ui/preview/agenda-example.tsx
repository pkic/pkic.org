import { ContentAgenda } from "../../site/ContentAgenda";
import { eventParticipationLink } from "../../../shared/event-participation-link";
import type { ContentAgendaDay } from "../../../shared/site-agenda";
import type { PreviewSection } from "./PreviewShell";

const agendaDays: ContentAgendaDay[] = ["2025-12-01", "2025-12-02"].map((date, index) => ({
  date,
  staffing: [
    {
      id: `preparation-${index}`,
      name: "Room preparation",
      startAt: `${date}T08:00:00.000Z`,
      endAt: `${date}T09:00:00.000Z`,
      locationId: "unused",
      duties: [{ role: "mc", displayName: "Alex Example" }],
    },
  ],
  locations: [
    { id: "main", label: "Main hall" },
    { id: "workshop", label: "Workshop room" },
    { id: "unused", label: "Unused room" },
  ],
  slots: [
    {
      startsAt: `${date}T09:00:00.000Z`,
      time: "10:00",
      sessions: [
        {
          id: `session-${index}`,
          title: "Preparing for post-quantum migration",
          kind: "session",
          locations: index ? ["main", "workshop"] : ["main"],
          speakers: ["Alex Example", "Sam Example", "Taylor Example"].map((name) => ({
            name,
            affiliations: [{ title: "Migration program lead", organization: { name: "Example Organization" } }],
          })),
          descriptionHtml: "",
          descriptionMarkdown:
            "A **practical discussion** of migration planning.\n\nBring your questions.  \nWe will close with a discussion.",
          endsAt: `${date}T09:30:00.000Z`,
          durationMinutes: 30,
          track: "Migration",
          youtube: "M7lc1UVf-VE",
          recordingApproved: true,
        },
      ],
    },
    {
      startsAt: `${date}T09:15:00.000Z`,
      time: "10:15",
      sessions: [
        {
          id: `parallel-${index}`,
          title: "An overlapping workshop with a longer title that must wrap without covering the next session",
          kind: "session",
          locations: ["workshop"],
          speakers: [{ name: "Jordan Example" }],
          descriptionHtml: "<p>Practical exercises for migration teams.</p>",
          endsAt: `${date}T10:00:00.000Z`,
          track: "Workshops",
        },
      ],
    },
    {
      startsAt: `${date}T10:00:00.000Z`,
      time: "11:00",
      sessions: [
        {
          id: `break-${index}`,
          title: "Coffee break",
          kind: "break",
          locations: [],
          speakers: [],
          descriptionHtml: "",
          endsAt: `${date}T10:15:00.000Z`,
        },
      ],
    },
  ],
}));

export function AgendaExample({ compact = false }: { compact?: boolean }) {
  return <ContentAgenda days={agendaDays} speakers={[]} timeZone="Europe/Amsterdam" compact={compact} />;
}

/** The reader's own sessions on a day with one more, hours later: what lies between them is cut from the list. */
const ownDays: ContentAgendaDay[] = agendaDays.map((day, index) => ({
  ...day,
  slots: [
    // A session that takes participation carries the reader's marks.
    ...day.slots.map((slot) => ({
      ...slot,
      sessions: slot.sessions.map((session) =>
        session.kind === "session" && session.id
          ? { ...session, participation: eventParticipationLink("preview", session.id, "preference") }
          : session,
      ),
    })),
    {
      startsAt: `${day.date}T15:00:00.000Z`,
      time: "16:00",
      sessions: [
        {
          id: `closing-${index}`,
          title: "What to do on Monday morning",
          kind: "session" as const,
          locations: ["main"],
          speakers: [{ name: "Riley Example" }],
          descriptionHtml: "",
          endsAt: `${day.date}T15:30:00.000Z`,
          durationMinutes: 30,
          participation: eventParticipationLink("preview", `closing-${index}`, "preference"),
        },
      ],
    },
  ],
}));
const OWN = new Set(["session-0", "closing-0"]);

/** My agenda: the agenda's own list with only the reader's sessions. */
function OwnAgendaExample() {
  return (
    <ContentAgenda
      days={ownDays}
      speakers={[]}
      timeZone="Europe/Amsterdam"
      personal={{ mineOnly: true, session: (id) => ({ starred: OWN.has(id), onStar: () => {} }) }}
    />
  );
}

export const agendaSections: PreviewSection[] = [
  {
    id: "agenda",
    title: "Agenda",
    render: () => <AgendaExample />,
  },
  {
    id: "agenda-mine",
    title: "My agenda",
    note: "The agenda's own list with only the reader's sessions. Slots holding none of them leave the list, and the next session shown opens under a dashed rule that says how long passes, so two sessions hours apart are read together.",
    render: () => <OwnAgendaExample />,
  },
];
