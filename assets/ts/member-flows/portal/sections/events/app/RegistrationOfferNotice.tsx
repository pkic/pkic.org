/** The event app keeps registration in the signed-in person's current context. */
import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../hooks/useHashQueryParam";
import { REGISTRATION_STEP_PARAM } from "../../../../../shared/form/step-navigation";
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
  const [step, setStep] = useHashQueryParam(REGISTRATION_STEP_PARAM, "", ["", "1", "2", "3", "4"]);
  const [mounted, setMounted] = useState(step !== "");
  const open = step !== "";
  const [, navigate] = usePortalHashLocation();
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <>
      <div class="pk-cluster">
        <Button
          variant="primary"
          onClick={() => {
            setMounted(true);
            setStep("1");
          }}
        >
          Register
        </Button>
      </div>
      {mounted && (
        <Dialog
          open={open}
          size="wide"
          title="Register for this event"
          closeLabel="Close registration"
          viewer
          confirmLabel="Register"
          description="Use your saved details and choose how you'll attend."
          onConfirm={() => {}}
          onCancel={() => window.history.go(-Number(step || "1"))}
        >
          <Suspense fallback={<Spinner label="Loading registration…" />}>
            <EventRegistrationCreate
              slug={slug}

              onRegistered={async () => {
                await onRegistered?.();
                setMounted(false);
                navigate(`/events/${encodeURIComponent(slug)}/ticket`);
              }}
            />
          </Suspense>
        </Dialog>
      )}
    </>
  );
}
