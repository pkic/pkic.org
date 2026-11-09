import { CancelledRegistrationNotice } from "../../event-flows/registration-cancelled-notice";
import type { PreviewSection } from "./PreviewShell";
import "../Alert.css";
import { RegistrationAffiliation } from "../../components/events/RegistrationAffiliation";
import { RegistrationDayStatusSummary } from "../../components/RegistrationDayStatusSummary";

export const registrationSections: PreviewSection[] = [
  {
    id: "registration-review-state",
    title: "Registration review state",
    note: "Pending organization claims stay separate from identity facts; an offer without a saved attendance choice shows its deadline and directs the attendee to the organizer.",
    render: () => (
      <div class="pk-stack">
        <RegistrationAffiliation organizationName={null} jobTitle={null} pendingOrganizationName="Example Research" />
        <RegistrationDayStatusSummary
          dayAttendance={[]}
          dayWaitlist={[{ dayDate: "2026-12-01", status: "offered", offerExpiresAt: "2026-12-01T12:00:00.000Z" }]}
          onClaim={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "registration-mixed-days",
    title: "Registration with waitlist-only days",
    note: "Each group names its dates when confirmed and waitlist-only days share one registration.",
    render: () => (
      <RegistrationDayStatusSummary
        dayAttendance={[
          { dayDate: "2026-12-01", attendanceType: "in_person", label: null },
          { dayDate: "2026-12-02", attendanceType: "in_person", label: null },
        ]}
        dayWaitlist={[
          { dayDate: "2026-12-03", status: "waiting" },
          { dayDate: "2026-12-04", status: "waiting" },
        ]}
      />
    ),
  },
  {
    id: "cancelled-registration",
    title: "Cancelled registration",
    note: "The cancellation leads the page, with restoration only when the attendee can request it.",
    render: () => (
      <div class="pk-stack">
        {(["restorable", "unverified", "unauthorized"] as const).map((reason) => (
          <div key={reason} class="pk-alert pk-alert--warn" role="alert">
            <CancelledRegistrationNotice reason={reason} onRestore={async () => undefined} />
          </div>
        ))}
      </div>
    ),
  },
];
