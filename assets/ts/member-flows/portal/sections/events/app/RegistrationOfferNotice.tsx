/** The reader's way into the existing registration flow, or why there is none. */
import { ButtonLink } from "../../../../../ui/Button";
import type { RegistrationOffer } from "./event-app-model";

export function RegistrationOfferNotice({ offer }: { offer: RegistrationOffer }) {
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <div class="pk-stack pk-stack--tight">
      <p>You are not registered for this event yet.</p>
      <div class="pk-cluster">
        <ButtonLink variant="primary" href={offer.href}>
          {offer.kind === "open" ? "Register" : "Register on the event page"}
        </ButtonLink>
      </div>
    </div>
  );
}
