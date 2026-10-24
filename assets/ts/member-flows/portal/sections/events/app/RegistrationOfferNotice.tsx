/** The event app keeps registration in the signed-in person's current context. */
import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import { Button } from "../../../../../ui/Button";
import { Dialog } from "../../../../../ui/Dialog";
import { Spinner } from "../../../../../components/Spinner";
import { usePortalHashLocation } from "../../../hash-location";
import type { RegistrationOffer } from "./event-app-model";

const EventRegistrationCreate = lazy(() =>
  import("../../../../../components/events/EventRegistrationCreate").then((module) => ({
    default: module.EventRegistrationCreate,
  })),
);

export function RegistrationOfferNotice({
  offer,
  slug,
  onRegistered,
}: {
  offer: RegistrationOffer;
  slug: string;
  onRegistered?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = usePortalHashLocation();
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <>
      <div class="pk-cluster">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Register
        </Button>
      </div>
      {open && (
        <Dialog
          open
          title="Register for this event"
          closeLabel="Close registration"
          viewer
          confirmLabel="Register"
          description="Use your saved details and choose how you'll attend."
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        >
          <Suspense fallback={<Spinner label="Loading registration…" />}>
            <EventRegistrationCreate
              slug={slug}
              onCancel={() => setOpen(false)}
              onRegistered={async () => {
                await onRegistered?.();
                setOpen(false);
                navigate(`/events/${encodeURIComponent(slug)}/ticket`);
              }}
            />
          </Suspense>
        </Dialog>
      )}
    </>
  );
}
