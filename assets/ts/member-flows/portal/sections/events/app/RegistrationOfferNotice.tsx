/** The reader's way into the existing registration flow, or why there is none. */
import { ButtonLink } from "../../../../../ui/Button";
import type { RegistrationOffer } from "./event-app-model";

export function RegistrationOfferNotice({ offer }: { offer: RegistrationOffer }) {
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  // Both offers lead to the same flow: the registration page, or the event page that links it.
  return (
    <div class="pk-cluster">
      <ButtonLink variant="primary" href={offer.href}>
        Register
      </ButtonLink>
    </div>
  );
}
