import { HeadshotDialogTemplates } from "./HeadshotDialogTemplates";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { EventPersonalFields } from "./EventPersonalFields";

/** Registration management markup consumed by the existing token-bound controller. */
export function EventRegistrationManagement() {
  return (
    <div
      class="event-flow pk"
      data-event-registration-manage
      data-api-base="/api/v1"
      data-module="event-flows/registration-manage-page"
    >
      <div data-manage-status-banner class="pk-alert pk-alert--warn" role="status" aria-live="polite" hidden />
      <div data-resend-manage-section class="pk-stack" hidden>
        <Field
          id="resend-manage-email"
          label="Your email address"
          help="Enter the email address you used to register and we'll send you a new management link."
        >
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              data-resend-manage-email
            />
          )}
        </Field>
        <div class="pk-cluster">
          <Button type="button" data-resend-manage-btn variant="primary">
            Send my management link
          </Button>
        </div>
        <p data-resend-manage-status class="pk-small" />
      </div>
      <div data-manage-greeting class="pk-cluster" hidden>
        <p data-manage-greeting-text />
        <span data-manage-status-badge />
      </div>
      <p data-manage-loading class="pk-muted pk-small">
        Loading your registration…
      </p>
      <div data-manage-share />
      <div data-manage-form class="pk-stack pk-stack--loose" hidden>
        <div data-headshot-section id="manage-headshot" class="pk-stack pk-stack--snug">
          <h3>Your photo</h3>
          {/* The photo tile is rendered here by the page module. */}
          <div data-headshot-tile />
          <p data-headshot-status class="pk-muted pk-small" role="status" />
        </div>
        <div class="pk-stack pk-stack--snug" data-day-waitlist-section hidden>
          <h3>Waitlist status</h3>
          <p class="pk-muted pk-small">
            These days are still pending. You can keep your registration, change those days to on-demand, or cancel the
            whole registration.
          </p>
          <div data-day-waitlist />
        </div>
        <div data-sponsor-contact-sharing />
        {/* The read view — details, the edit command and the whole-record
            commands — is rendered here by the page module; the form below
            stays hidden until the attendee chooses to edit. */}
        <div data-manage-summary />
        <form class="pk-form pk-stack--loose needs-validation" noValidate hidden>
          <p data-registration-identity-note class="pk-muted pk-small" hidden>
            This registration keeps the identity details you confirmed for this event.
          </p>
          <div class="pk-stack pk-stack--snug">
            <h3>Your details</h3>
            <Field id="manage-email" label="Email address" errorSlot="email">
              {(control) => <TextInput {...control} name="email" type="email" autoComplete="email" />}
            </Field>
            <p data-email-change-notice class="pk-warning-note" hidden>
              Changing your email will require you to confirm the new address before your registration is active again.
            </p>
            <EventPersonalFields prefix="manage" />
          </div>
          <div data-custom-fields-section class="pk-stack pk-stack--snug">
            <h3>Event questions</h3>
            <div data-custom-fields>
              <p class="pk-muted pk-small">Loading…</p>
            </div>
          </div>
          <div class="pk-stack pk-stack--snug">
            <h3>Attendance per day</h3>
            <Field
              group
              label="Attendance"
              errorSlot="dayAttendance"
              help="Change attendance mode for each day. For multi-day events, switch a day to On demand to watch the recording instead of canceling individual days."
            >
              {() => (
                <div data-day-attendance>
                  <p class="pk-muted pk-small">Loading event days…</p>
                </div>
              )}
            </Field>
          </div>
          <div class="pk-cluster" data-action-buttons>
            <Button type="submit" variant="primary">
              Save changes
            </Button>
            <Button type="button" data-action="discard" variant="secondary">
              Discard changes
            </Button>
          </div>
        </form>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </div>
      <HeadshotDialogTemplates />
      <div data-post-action hidden>
        <div class="pk-alert" data-post-action-alert>
          <h4 class="pk-alert__title" data-post-action-title />
          <p class="pk-alert__body" data-post-action-message />
        </div>
      </div>
    </div>
  );
}
