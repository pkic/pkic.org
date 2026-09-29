/**
 * One registration's own page inside its group event.
 *
 * A record with facets — the days, the waitlist, the admissions — is a
 * routed page: the trail says where it sits, the header says who it is and
 * whether they are registered, and the attendance manager takes the width
 * with the registration's facts beside it. It fetches itself by id through
 * the group's own attendance route, so a copied URL opens the same record
 * the list row did.
 */
import { useState } from "preact/hooks";
import {
  eventRegistrationAttendanceDetailResponseSchema,
  eventRegistrationManagerUpdateResponseSchema,
} from "../../../../../shared/schemas/event-registration-detail";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { patchJson } from "../../../../shared/api-client";
import type { MenuItem } from "../../../../ui/Menu";
import { toast } from "../../ui";
import type { RegistrationDayState } from "../../../../../shared/schemas/event-registrations";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { DayAttendanceManager } from "../../../../components/event-registrations/DayAttendanceManager";
import { describeRegistrationDays } from "../../../../components/event-registrations/RegistrationDayStates";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Avatar } from "../../../../ui/Avatar";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { attendanceTypeLabel } from "../../../../shared/attendance";
import { fmt } from "../../ui";

/** The source vocabulary in product words. */
const SOURCE_LABELS: Record<string, string> = {
  direct: "Registered directly",
  invite: "Accepted an invitation",
  referral: "Came through a referral link",
  social: "Came through a social post",
  partner: "Came through a partner",
  campaign: "Came through a campaign",
  unknown: "Source unknown",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ");
}

export function GroupEventRegistrationRecord({
  groupId,
  eventId,
  registrationId,
  canVip,
  onChanged,
}: {
  groupId: string;
  eventId: string;
  registrationId: string;
  /** Server-derived effective event manage capability; never inferred here. */
  canVip: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const eventEndpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;
  const registrationEndpoint = `${eventEndpoint}/registrations/${encodeURIComponent(registrationId)}`;
  const detail = useData(
    () => getJson(registrationEndpoint, eventRegistrationAttendanceDetailResponseSchema),
    [registrationEndpoint],
  );
  // While another registration loads, useData still holds the previous one;
  // showing it would put one attendee's name over another's days.
  const loaded = detail.data?.registration.id === registrationId ? detail.data : null;
  // The record's header menu holds what concerns the registration as a
  // whole. Anything about a day — its method, its seat, leaving it — is done
  // on the day's row, or on several rows at once through the list's
  // selection, so there is one way to change a day (#113).
  const [busy, setBusy] = useState(false);

  if (detail.loading && !loaded) return <Spinner label="Loading this registration…" />;
  if (detail.error && !loaded) return <ErrorAlert error={detail.error} />;
  if (!loaded) return null;

  const registration = loaded.registration;
  const name = registration.display_name ?? registration.user_email ?? "Attendee";
  const waitlistByDay = new Map(loaded.dayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));
  // The same per-day vocabulary the list speaks, derived here from the
  // record's two lists so the header and the row never disagree.
  const days: RegistrationDayState[] = loaded.dayAttendance.map((day) => {
    const waitlist = waitlistByDay.get(day.dayDate);
    return {
      dayDate: day.dayDate,
      label: day.label,
      attendanceType: day.attendanceType,
      waitlistStatus: waitlist === "waiting" || waitlist === "offered" ? waitlist : null,
    };
  });

  const cancelled = registration.status === "cancelled";

  async function reloadAfter(message: string): Promise<void> {
    toast(message, "success");
    await detail.reload();
    await onChanged?.();
  }

  async function cancelRegistration(): Promise<void> {
    const confirmed = await confirmAction({
      title: `Cancel the registration for ${name}?`,
      body: "Every held day is released and the attendee is told.",
      consequences: ["Waitlist places are given up.", "The attendee would have to register again to return."],
      confirmLabel: "Cancel registration",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await patchJson(registrationEndpoint, { action: "cancel" }, eventRegistrationManagerUpdateResponseSchema);
      await reloadAfter("Registration cancelled; the attendee was notified.");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const commands: MenuItem[] = canVip
    ? [
        {
          id: "cancel",
          label: "Cancel registration…",
          danger: true,
          disabled: busy || cancelled,
          onSelect: () => void cancelRegistration(),
        },
      ]
    : [];

  return (
    <BreadcrumbBranch items={[{ label: name }]}>
      <section class="pk pk-stack" aria-label={`Registration for ${name}`}>
        {detail.error && <ErrorAlert error={detail.error} />}
        <ProfileHeader
          headingLevel={3}
          media={<Avatar name={name} size="lg" />}
          title={name}
          lede={registration.user_email ?? undefined}
          context={<Badge status={registration.status} />}
          facts={[
            describeRegistrationDays(days, registration.attendance_type),
            `Registered ${fmt(registration.created_at)}`,
            sourceLabel(registration.source_type),
          ]}
          actions={commands.length > 0 ? <Menu label="Registration actions" align="end" items={commands} /> : undefined}
        />
        <div class="pk-record">
          {/* The list sits flush under the panel's header, the way every
              list panel draws its rows: no body padding around a table. */}
          <Panel aria-label="Attendance by day">
            <PanelHeader title="Attendance by day" />
            <DayAttendanceManager
              dayAttendance={loaded.dayAttendance}
              dayWaitlist={loaded.dayWaitlist}
              eventDays={loaded.eventDays}
              registrationEndpoint={registrationEndpoint}
              canVip={canVip}
              onReload={async () => {
                await detail.reload();
                await onChanged?.();
              }}
            />
          </Panel>
          <aside class="pk-stack pk-datalist-aligned">
            <Panel aria-label="Registration facts">
              <PanelHeader title="Registration" />
              <PanelBody>
                <DescriptionList
                  density="compact"
                  items={[
                    { term: "Status", value: <Badge status={registration.status} /> },
                    { term: "Attendance", value: attendanceTypeLabel(registration.attendance_type) },
                    { term: "Source", value: sourceLabel(registration.source_type) },
                    { term: "Registered", value: fmt(registration.created_at) },
                    { term: "Last updated", value: fmt(registration.updated_at) },
                  ]}
                />
              </PanelBody>
            </Panel>
          </aside>
        </div>
      </section>
    </BreadcrumbBranch>
  );
}
