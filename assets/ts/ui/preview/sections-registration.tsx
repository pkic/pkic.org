import { RegistrationRepresentationField } from "../../components/events/RegistrationRepresentationField";
import { RegistrationEmailAddress } from "../../components/events/RegistrationEmailAddress";
import { registrationManageReadResponseSchema } from "../../../shared/schemas/registration";
import { CancelledRegistrationNotice } from "../../event-flows/registration-cancelled-notice";
import type { PreviewSection } from "./PreviewShell";
import "../Alert.css";

const readOnlyRegistration = registrationManageReadResponseSchema.parse({
  success: true,
  sponsorSharing: { allowed: false, withdrawnAt: null },
  registration: {
    id: "00000000-0000-4000-8000-000000000071",
    event_id: "preview-event",
    status: "registered",
    cancellation_reason_code: null,
    custom_answers: null,
    isEmailVerified: true,
  },
  event: { id: "preview-event", slug: "preview", name: "Example conference", startsAt: null },
  user: {
    email: "attendee@example.test",
    first_name: "Example",
    last_name: "Attendee",
    organization_name: "Example Trust",
    job_title: "Engineer",
  },
  eventDays: [],
  dayAttendance: [],
  dayWaitlist: [],
  waitlistHandledLast: false,
  shareUrl: null,
  headshotUrl: null,
});

export const registrationSections: PreviewSection[] = [
  {
    id: "registration-representation",
    title: "Registration representation",
    note: "A manage link without an owner session shows the current representation and how to sign in.",
    render: () => (
      <div class="pk-stack">
        <RegistrationRepresentationField
          data={readOnlyRegistration}
          onSelect={() => undefined}
          onUpdated={async () => undefined}
        />
        <RegistrationEmailAddress email={readOnlyRegistration.user.email} />
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
