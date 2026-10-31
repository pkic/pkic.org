import { render } from "preact";
import { eventFormsResponseSchema } from "../../shared/schemas/forms";
import { getJson } from "../shared/api-client";
import { eventFlowContext, setStatus } from "./boot";
import { RegistrationFlow } from "../components/events/RegistrationFlow";
import { showRegistrationSuccess } from "./registration-success";

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
      <RegistrationFlow
        mode="create"
        forms={forms}
        context={context}
        onRegistered={(result, body, form) => {
          showRegistrationSuccess(
            context.root,
            form,
            result,
            body.firstName,
            body.lastName,
            body.email,
            body.organization?.name ?? "",
            forms.event.name,
            context.eventSlug,
          );
        }}
      />,
      mount,
    );
  } catch {
    setStatus(mount, "Could not load registration form details. Reload this page to try again.", true);
  }
}
void main();
