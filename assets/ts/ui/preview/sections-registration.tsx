import { CancelledRegistrationNotice } from "../../event-flows/registration-cancelled-notice";
import type { PreviewSection } from "./PreviewShell";
import "../Alert.css";

export const registrationSections: PreviewSection[] = [
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
