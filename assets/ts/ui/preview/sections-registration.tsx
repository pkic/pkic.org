import { CancelledRegistrationNotice } from "../../event-flows/registration-cancelled-notice";
import type { PreviewSection } from "./PreviewShell";
import "../Alert.css";
import { RegistrationAffiliation } from "../../components/events/RegistrationAffiliation";
import { RegistrationDayStatusSummary } from "../../components/RegistrationDayStatusSummary";

export const registrationSections: PreviewSection[] = [
  {
    id: "registration-review-state",
    title: "Registration review state",
    note: "Pending organization claims stay separate from identity facts; a waitlist entry without a selected option explains how to request a place.",
    render: () => (
      <div class="pk-stack">
        <RegistrationAffiliation organizationName={null} jobTitle={null} pendingOrganizationName="Example Research" />
        <RegistrationDayStatusSummary
          dayAttendance={[]}
          dayWaitlist={[{ dayDate: "2026-12-01", status: "offered" }]}
          onClaim={() => undefined}
        />
      </div>
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
