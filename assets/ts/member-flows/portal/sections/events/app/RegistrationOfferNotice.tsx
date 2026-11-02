/** Open the shared registration flow at its own event page. */
import { ButtonLink } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import type { RegistrationOffer } from "./event-app-model";

export function RegistrationOfferNotice({ offer, slug }: { offer: RegistrationOffer; slug: string }) {
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}/register/`)}>
      Register
    </ButtonLink>
  );
}
