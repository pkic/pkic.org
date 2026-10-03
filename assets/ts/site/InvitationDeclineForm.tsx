import { declineReasonCodeSchema } from "../../shared/schemas/registration";
import { Field } from "../ui/Field";
import { TextInput, Textarea } from "../ui/TextControl";
import { Checkbox, Radio } from "../ui/Checkbox";
import { Button, ButtonLink } from "../ui/Button";

/** The existing invitation controller owns token checks, copy, and submission. */
export function InvitationDeclineForm() {
  return (
    <div class="pk pk-container pk-center" data-module="invite-decline">
      <div data-invite-decline data-api-base="/api/v1">
        <div data-decline-loading>
          <p role="status">Loading invitation…</p>
        </div>
        <div data-decline-status hidden>
          <div class="pk-alert pk-alert--info" data-status-alert role="alert">
            <h2 class="pk-alert__title" data-status-title />
            <p data-status-body />
          </div>
          <div data-resend-invite-section hidden>
            <Field id="resend-invite-email" label="Email address from the invitation">
              {(control) => <TextInput {...control} type="email" autoComplete="email" data-resend-invite-email />}
            </Field>
            <Button type="button" data-resend-invite-btn>
              Send fresh invitation
            </Button>
            <p data-resend-invite-status />
          </div>
          <p>
            <a href="/">Return to PKI Consortium</a>
          </p>
        </div>
        <div data-decline-form hidden>
          <h1 class="pk-strong" data-copy-target="heading" />
          <p class="pk-muted">
            Hi <strong data-placeholder="firstName">there</strong> — <span data-copy-target="intro" />
          </p>
          <div data-error-banner class="pk-alert pk-alert--danger" hidden role="alert" />
          <div
            data-virtual-pivot
            data-attendee-only
            class="pk-alert pk-alert--info"
            hidden
            role="region"
            aria-label="Virtual attendance option"
          >
            <p>
              Can't make it in person? The event also has a virtual live-stream option. You can attend from anywhere in
              the world at no extra cost.
            </p>
            <ButtonLink data-registration-link href="#">
              Register for the Virtual Stream →
            </ButtonLink>
          </div>
          <div
            data-on-demand-pivot
            data-attendee-only
            class="pk-alert pk-alert--info"
            hidden
            role="region"
            aria-label="On-demand access option"
          >
            <p>
              Can't make this date? Register for on-demand access and get the session recordings on your own schedule
              after the event.
            </p>
            <ButtonLink data-registration-link href="#">
              Register for On-Demand Access →
            </ButtonLink>
          </div>
          <div
            data-convince-boss
            data-attendee-only
            class="pk-alert pk-alert--info"
            hidden
            role="region"
            aria-label="Organization approval"
          >
            <p>
              Need to convince your organization? Virtual attendance is also available —{" "}
              <a data-registration-link-boss href="#">
                register for the virtual stream
              </a>{" "}
              if in-person approval is difficult to obtain.
            </p>
          </div>
          <form data-decline-form-el class="pk-form pk-start" noValidate>
            <Field group label="Reason for declining" errorSlot="reasonCode">
              {() => (
                <div data-reason-options class="pk-stack pk-stack--snug">
                  {declineReasonCodeSchema.options.map((reason) => (
                    <Radio
                      key={reason}
                      name="reasonCode"
                      value={reason}
                      label={<span data-reason-label={reason}>{reason === "other" ? "Other reason" : ""}</span>}
                    />
                  ))}
                  <p data-reason-error class="pk-field__message" aria-live="polite" hidden>
                    Please select a reason before submitting.
                  </p>
                </div>
              )}
            </Field>
            <div data-topic-suggestion hidden>
              <Field
                id="topicSuggestion"
                label={<span data-copy-target="topic-label" />}
                help={<span data-copy-target="topic-help" />}
              >
                {(control) => <TextInput {...control} data-topic-input maxLength={200} />}
              </Field>
            </div>
            <Field
              id="reasonNote"
              label={
                <>
                  Additional comments{" "}
                  <span data-note-optional class="pk-muted">
                    (optional)
                  </span>
                </>
              }
            >
              {(control) => (
                <>
                  <Textarea {...control} data-reason-note rows={3} maxLength={2000} />
                  <p data-note-error class="pk-field__message" aria-live="polite" hidden>
                    Please add a brief explanation for “Other reason”.
                  </p>
                </>
              )}
            </Field>
            <div data-nps-section>
              <p class="pk-strong" data-copy-target="nps-question" />
              <div class="pk-cluster" data-nps-buttons role="group" aria-label="Likelihood score 1 to 10">
                <span class="pk-muted">Very unlikely</span>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <Button key={score} type="button" variant="secondary" size="sm" data-nps={score}>
                    {score}
                  </Button>
                ))}
                <span class="pk-muted">Very likely</span>
              </div>
              <input type="hidden" data-nps-value />
            </div>
            <Checkbox id="unsubscribeFuture" data-unsubscribe-future label={<span data-copy-target="unsubscribe" />} />
            <hr />
            <Button
              type="button"
              variant="link"
              data-forward-toggle
              aria-expanded="false"
              aria-controls="forwardEntries"
            >
              <span data-forward-arrow aria-hidden="true">
                ▶
              </span>
              <span data-copy-target="forward-toggle" />
            </Button>
            <div id="forwardEntries" data-forward-entries hidden>
              <div class="event-flow-invite">
                <p class="event-flow-invite-copy" data-copy-target="forward-copy" />
                <Field id="decline-forward-paste" label="Paste contacts to invite">
                  {(control) => (
                    <Textarea
                      {...control}
                      data-decline-forward-paste
                      rows={3}
                      placeholder="Jane Smith <jane@example.com>"
                    />
                  )}
                </Field>
                <div class="event-flow-invite-list" data-forward-list />
                <Button type="button" variant="secondary" size="sm" data-add-forward>
                  + Add a contact
                </Button>
              </div>
            </div>
            <hr />
            <Button type="submit" variant="danger" data-submit-btn>
              <span data-copy-target="submit" />
            </Button>
          </form>
        </div>
        <div data-decline-success class="pk-container pk-container--narrow pk-stack pk-center" hidden>
          <h2 class="pk-strong" data-copy-target="success-title" />
          <p class="pk-muted" data-success-forwarded />
          <p class="pk-muted" data-copy-target="success-body" />
          <div class="pk-panel">
            <p class="pk-strong">In the meantime, stay up to date:</p>
            <ul class="pk-stack pk-start">
              <li>
                <a href="/resources/">Browse our PKI resources library</a>
              </li>
              <li>
                <a href="/blog/">Read the latest news from the PKI Consortium</a>
              </li>
            </ul>
          </div>
          <p>
            <a href="/events/">View upcoming PKI Consortium events</a> so you can plan ahead for next time.
          </p>
        </div>
      </div>
    </div>
  );
}
