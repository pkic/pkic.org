import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { Checkbox } from "../ui/Checkbox";
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
          <div class="pk-split">
            <Field id="registration-first-name" label="First name" errorSlot="firstName" required>
              {(control) => <TextInput {...control} name="firstName" required autoComplete="given-name" />}
            </Field>
            <Field id="registration-last-name" label="Last name" errorSlot="lastName" required>
              {(control) => <TextInput {...control} name="lastName" required autoComplete="family-name" />}
            </Field>
          </div>
          <div data-registration-identity />
          <Field
            id="registration-email"
            label="Work email"
            errorSlot="email"
            help="We'll send your confirmation, calendar invite, and event updates here."
            required
          >
            {(control) => <TextInput {...control} name="email" type="email" required autoComplete="email" />}
          </Field>
          <p data-email-warning class="pk-warning-note" hidden>
            This looks like a personal email address. Please use your professional email so we can verify your
            affiliation.
          </p>
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
          <p class="event-flow-step-intro">
            Please check your registration details carefully, then review and agree to the terms and conditions before
            submitting. Your registration is not final until you confirm through the link sent to your email.
          </p>
          <div data-registration-review>
            <p class="pk-muted pk-small">Preparing your review…</p>
          </div>
          <div class="event-flow-terms-heading">
            <h3 class="event-flow-terms-title">Confirm and agree</h3>
            <p class="event-flow-terms-help">
              Check your email address, then accept the required terms before submitting.
            </p>
          </div>
          <Field group label="Email confirmation" errorSlot="emailReviewConfirmed">
            {() => (
              <section class="pk-panel" data-email-review-card>
                <div class="pk-panel__body">
                  <Checkbox
                    id="registration-email-review-confirmed"
                    name="emailReviewConfirmed"
                    data-consent-input
                    required
                    fill
                    label={
                      <>
                        I checked that <strong data-registration-review-email-inline>the email address above</strong> is
                        correct and understand I am not registered until I confirm through that email.
                      </>
                    }
                  />
                </div>
              </section>
            )}
          </Field>
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
            ← Back
          </Button>
          <div class="event-flow-step-forward">
            <Button type="button" variant="primary" size="lg" data-step-next disabled>
              Continue →
            </Button>
            <Button type="submit" variant="primary" size="lg" hidden>
              Submit registration →
            </Button>
          </div>
        </div>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </form>
    </div>
  );
}
