import type { ProposalSpeakerAttendance as SpeakerAttendance } from "../../../shared/schemas/event-proposals";
import { formatDayAndMonth } from "../../../shared/format-date";
import { Badge } from "../Badge";
import { registrationDayStatus } from "../event-registrations/RegistrationDayStates";
import { attendanceTypeLabel } from "../../shared/attendance";

export function ProposalSpeakerAttendance({ speakers }: { speakers: readonly SpeakerAttendance[] }) {
  if (!speakers.length) return <span class="pk-muted">No speakers</span>;
  return (
    <ul class="pk-plain-list pk-stack pk-stack--snug" aria-label="Speaker registrations">
      {speakers.map((speaker) => (
        <li key={speaker.userId} class="pk-stack pk-stack--tight">
          <span class="pk-strong">{[speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || "Speaker"}</span>
          {speaker.organizationName && <span class="pk-muted pk-small">{speaker.organizationName}</span>}
          <span>
            {speaker.status === "declined" ? <Badge status="declined" /> : null}{" "}
            {speaker.registrationStatus ? <Badge status={speaker.registrationStatus} /> : "Not registered"}
          </span>
          {speaker.registrationStatus === "registered" &&
            (speaker.days.length ? (
              <ul class="pk-plain-list pk-small" aria-label="Registered days">
                {speaker.days.map((day) => (
                  <li key={day.dayDate}>
                    {formatDayAndMonth(day.dayDate)}
                    {day.label ? ` · ${day.label}` : ""}: {registrationDayStatus(day).label}
                  </li>
                ))}
              </ul>
            ) : (
              <span class="pk-muted pk-small">{attendanceTypeLabel(speaker.attendanceType)} · No days selected</span>
            ))}
        </li>
      ))}
    </ul>
  );
}
