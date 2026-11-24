/** After registering: if the ticket has to be paid, take the person straight to payment. */
import {
  registrationTicketCheckoutResponseSchema,
  registrationTicketResponseSchema,
} from "../../../../shared/schemas/registration-tickets";
import { getJson, postJson } from "../../../shared/api-client";

/**
 * Leaves for the payment page when the registration's ticket is unpaid, and
 * says whether it did. A failure is not an error for the caller: the person
 * is registered, has the payment email, and can pay from their ticket page.
 */
export async function continueToTicketPayment(slug: string, registrationId: string): Promise<boolean> {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(registrationId)}/ticket`;
  try {
    const { ticket } = await getJson(base, registrationTicketResponseSchema);
    if (ticket?.status !== "pending_payment") return false;
    const { checkoutUrl } = await postJson(`${base}/checkout`, {}, registrationTicketCheckoutResponseSchema);
    window.location.assign(checkoutUrl);
    return true;
  } catch {
    return false;
  }
}
