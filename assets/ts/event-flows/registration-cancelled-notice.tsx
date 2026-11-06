import { useState } from "preact/hooks";
import { Button } from "../ui/Button";

export type CancelledRegistrationReason = "restorable" | "unverified" | "unauthorized";

const COPY: Record<CancelledRegistrationReason, { title: string; body: string }> = {
  restorable: {
    title: "This registration is cancelled",
    body: "Badge download and colleague invitations are no longer available. Restore your registration to take part again while registration is open.",
  },
  unverified: {
    title: "This registration is cancelled",
    body: "It was cancelled because your email address could not be verified. Check or correct your email address and try again to restore your registration.",
  },
  unauthorized: {
    title: "This registration was reported as unauthorized",
    body: "It cannot be restored here. Please contact the organizer if it should be reviewed.",
  },
};

/**
 * What a cancelled registration's page leads with: that it is cancelled, why,
 * and the way back when there is one. It fills the page's status banner.
 */
export function CancelledRegistrationNotice({
  reason,
  onRestore,
}: {
  reason: CancelledRegistrationReason;
  onRestore: () => Promise<void>;
}) {
  const [restoring, setRestoring] = useState(false);
  const copy = COPY[reason];
  return (
    <>
      <div class="pk-alert__title">{copy.title}</div>
      <div class="pk-alert__body pk-stack pk-stack--snug">
        <p>{copy.body}</p>
        {reason === "restorable" && (
          <div class="pk-cluster">
            <Button
              variant="primary"
              loading={restoring}
              onClick={() => {
                setRestoring(true);
                onRestore().catch(() => setRestoring(false));
              }}
            >
              Restore registration
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
