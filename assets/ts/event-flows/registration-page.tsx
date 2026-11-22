import { render } from "preact";
import { eventFormsResponseSchema } from "../../shared/schemas/forms";
import { getJson } from "../shared/api-client";
import { eventFlowContext, setStatus } from "./boot";
import { RegistrationFlow } from "../components/events/RegistrationFlow";
import { showRegistrationSuccess } from "./registration-success";
import { EventTicketPricing } from "../components/events/tickets/EventTicketPricing";
import { continueToTicketPayment } from "../components/events/tickets/ticket-payment";
import { eventParticipantRecordPath } from "../../shared/event-participant-paths";

async function main() {
  const context = eventFlowContext(document.querySelector<HTMLElement>("[data-event-registration]"));
  if (!context) return;
  const mount = context.root.querySelector<HTMLElement>("[data-registration-flow-mount]");
  if (!mount) return;
  try {
    const forms = await getJson(
      `${context.apiBase}/events/${encodeURIComponent(context.eventSlug)}/forms/placements/event_registration`,
      eventFormsResponseSchema,
    );
    mount.textContent = "";
    render(
      <EventTicketPricing slug={context.eventSlug}>
        <RegistrationFlow
          mode="create"
          forms={forms}
          context={context}
          onAlreadyRegistered={(registrationId) =>
            location.assign(`/portal/#${eventParticipantRecordPath(context.eventSlug, "registration", registrationId)}`)
          }
          onRegistered={async (result, body, form, names) => {
            // A ticket that must be paid goes straight to payment; the success page follows the payment.
            if (await continueToTicketPayment(context.eventSlug, result.registrationId)) return;
            showRegistrationSuccess(
              context.root,
              form,
              result,
              names.firstName,
              names.lastName,
              body.email,
              forms.event.name,
              context.eventSlug,
            );
          }}
        />
      </EventTicketPricing>,
      mount,
    );
  } catch {
    setStatus(mount, "Could not load registration form details. Reload this page to try again.", true);
  }
}
void main();
