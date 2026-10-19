import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { EventFlowProgress } from "./EventFlowProgress";

/** Static registration controls, enhanced by the canonical registration controller. */
export function EventRegistrationForm() {
  return (
    <div
      class="event-flow pk"
      data-event-registration
      data-api-base="/api/v1"
      data-module="event-flows/registration-page"
    >
      <EventFlowProgress label="Registration progress" steps={["You", "Attendance", "Profile", "Review"]} />
      <form class="pk-stack needs-validation" noValidate>
        <input name="referralCode" type="hidden" />
        <div data-step="1" class="event-flow-step is-active pk-stack">
          <div data-registration-contact />
        </div>
        <div data-step="2" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">Choose how you'll follow each day — you can update this later.</p>
          <Field group label="Attendance" errorSlot="dayAttendance">
            {() => (
              <div data-day-attendance>
                <p class="pk-muted pk-small">Loading event days…</p>
              </div>
            )}
          </Field>
        </div>
        <div data-step="3" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">Help us tailor the program and connect you with relevant people.</p>
          <div data-custom-fields>
            <p class="pk-muted pk-small">Loading…</p>
          </div>
        </div>
        <div data-step="4" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">Check your details, then accept the terms to register.</p>
          <div data-registration-review>
            <p class="pk-muted pk-small">Preparing your review…</p>
          </div>
          <Field group label="Terms and conditions" errorSlot="consents">
            {() => (
              <div data-consents>
                <p class="pk-muted pk-small">Loading…</p>
              </div>
            )}
          </Field>
        </div>
        <div class="event-flow-step-nav">
          <Button type="button" variant="link" data-step-back hidden>
            Back
          </Button>
          <div class="event-flow-step-forward">
            <Button type="button" variant="primary" data-step-next disabled>
              Continue
            </Button>
            <Button type="submit" variant="primary" hidden>
              Register
            </Button>
          </div>
        </div>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </form>
    </div>
  );
}
