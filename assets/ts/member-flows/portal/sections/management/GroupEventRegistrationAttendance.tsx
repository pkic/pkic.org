import { eventRegistrationAttendanceDetailResponseSchema } from "../../../../../shared/schemas/event-registration-detail";
import { Badge } from "../../../../components/Badge";
import { DayAttendanceManager } from "../../../../components/event-registrations/DayAttendanceManager";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
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

  if (detail.loading) return <Spinner />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;

  const registration = detail.data.registration;
  return (
    <section aria-label={`Attendance for ${registration.display_name ?? registration.user_email ?? "attendee"}`}>
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <h6 class="mb-1">{registration.display_name ?? registration.user_email ?? "Attendee"}</h6>
          {registration.user_email && <div class="small text-muted">{registration.user_email}</div>}
        </div>
        <div class="d-flex flex-wrap align-items-center gap-2 small">
          <Badge status={registration.status} />
          <span>{registration.attendance_type.replaceAll("_", " ")}</span>
          <span class="text-muted">Registered {fmt(registration.created_at)}</span>
        </div>
      </div>
      <DayAttendanceManager
        dayAttendance={detail.data.dayAttendance}
        dayWaitlist={detail.data.dayWaitlist}
        eventDays={detail.data.eventDays}
        registrationEndpoint={registrationEndpoint}
        idPrefix={`group-registration-${registrationId}`}
        canVip={canVip}
        onReload={detail.reload}
        onSuccess={(message) => void onUpdated?.(message)}
      />
    </section>
  );
}
