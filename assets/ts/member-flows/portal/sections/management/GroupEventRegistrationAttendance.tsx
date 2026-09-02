import { eventRegistrationAttendanceDetailResponseSchema } from "../../../../../shared/schemas/event-registration-detail";
import { Badge } from "../../../../components/Badge";
import { DayAttendanceManager } from "../../../../components/event-registrations/DayAttendanceManager";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { attendanceTypeLabel } from "../events/attendance";
import { fmt } from "../../ui";

export function GroupEventRegistrationAttendance({
  groupId,
  eventId,
  registrationId,
  canVip,
  onUpdated,
}: {
  groupId: string;
  eventId: string;
  registrationId: string;
  canVip: boolean;
  onUpdated?: (message: string) => void | Promise<void>;
}) {
  const eventEndpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;
  const registrationEndpoint = `${eventEndpoint}/registrations/${encodeURIComponent(registrationId)}`;
  const detail = useData(
    () => getJson(registrationEndpoint, eventRegistrationAttendanceDetailResponseSchema),
    [registrationEndpoint],
  );

  if (detail.loading) return <Spinner label="Loading this registration…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;

  const registration = detail.data.registration;
  return (
    <section
      class="pk pk-stack"
      aria-label={`Attendance for ${registration.display_name ?? registration.user_email ?? "attendee"}`}
    >
      <div class="pk-cluster pk-cluster--start pk-cluster--between">
        <div class="pk-stack pk-stack--tight">
          <h4>{registration.display_name ?? registration.user_email ?? "Attendee"}</h4>
          {registration.user_email && <p class="pk-small">{registration.user_email}</p>}
        </div>
        <div class="pk-cluster pk-small">
          <Badge status={registration.status} />
          {/* The shared vocabulary rather than an underscore-stripping
              replace, so "on_demand" reads the same here as everywhere else. */}
          <span>{attendanceTypeLabel(registration.attendance_type)}</span>
          <span class="pk-nowrap">Registered {fmt(registration.created_at)}</span>
        </div>
      </div>
      <DayAttendanceManager
        dayAttendance={detail.data.dayAttendance}
        dayWaitlist={detail.data.dayWaitlist}
        eventDays={detail.data.eventDays}
        registrationEndpoint={registrationEndpoint}
        canVip={canVip}
        onReload={detail.reload}
        onSuccess={(message) => void onUpdated?.(message)}
      />
    </section>
  );
}
