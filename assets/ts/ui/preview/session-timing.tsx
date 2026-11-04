import { personalAgendaSessionSchema } from "../../../shared/schemas/event-personal-agenda";
import { formatDateTime, formatDateTimeInZone } from "../../../shared/format-date";
import { SessionActionBar } from "../../member-flows/portal/sections/events/detail/participation/SessionActionBar";
import { Alert } from "../Alert";
import type { PreviewSection } from "./PreviewShell";

export const sessionTimingSection: PreviewSection = {
  id: "session-timing",
  title: "Session timing",
  note: "The join action opens shortly before the session; an old link explains what the room shows now.",
  render: () => {
    const now = Date.now();
    const session = personalAgendaSessionSchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      title: "Synthetic opening session",
      publishedRevision: 1,
      timeZone: "Europe/Amsterdam",
      rooms: [],
      startAt: new Date(now + 10 * 60_000).toISOString(),
      endAt: new Date(now + 70 * 60_000).toISOString(),
      admissionPolicy: "preference",
      status: null,
      attendanceMode: null,
      liveStreamRoomId: "10000000-0000-4000-8000-000000000002",
      availability: { attendanceMode: "physical", state: "available", message: "Open.", bookingAction: null },
    });
    return (
      <div class="pk-stack">
        <p>Viewer clock: {formatDateTime(session.startAt)}</p>
        <p>Meeting clock: {formatDateTimeInZone(session.startAt, session.timeZone)}</p>
        <SessionActionBar slug="timing-preview" session={session} onSaved={() => undefined} />
        <Alert title="Previous session has ended">Below is what is on in Main hall now.</Alert>
      </div>
    );
  },
};
