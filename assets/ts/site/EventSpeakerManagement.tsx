import { Field } from "../ui/Field";
import { Textarea } from "../ui/TextControl";
import { Button, ButtonLink } from "../ui/Button";
import { HeadshotDialogTemplates } from "./HeadshotDialogTemplates";
import { SpeakerLinkRecovery } from "./SpeakerLinkRecovery";

/** The canonical speaker controller supplies private data after token validation. */
export function EventSpeakerManagement() {
  return (
    <div
      class="event-flow pk"
      data-event-speaker-manage
      data-api-base="/api/v1"
      data-module="event-flows/speaker-manage-page"
    >
      <SpeakerLinkRecovery />
      <p data-speaker-loading class="pk-muted pk-small">
        Loading your speaker details…
      </p>
      <div data-speaker-content class="pk-container pk-container--start pk-stack pk-stack--loose" hidden>
        <div class="pk-stack pk-stack--tight" data-proposal-summary>
          <h3 data-proposal-title />
          <p class="pk-muted">
            Session type: <span data-proposal-type /> · Status: <span class="pk-badge" data-proposal-status-badge />
          </p>
          <p class="pk-muted" data-presentation-deadline-row />
        </div>
        <div class="pk-stack pk-stack--snug" data-participation-section>
          <h4>Your participation</h4>
          <p>
            Status: <span class="pk-badge" data-speaker-status-badge />
          </p>
          <div class="pk-stack pk-stack--snug" data-confirm-panel hidden>
            <p class="pk-muted">
              Please confirm whether you would like to participate in this session. Once the program committee accepts
              the proposal, you can upload your presentation.
            </p>
            <form id="speaker-participation-confirm" data-confirm-form class="pk-form" noValidate>
              <Field group label="Speaker terms and conditions" errorSlot="consents">
                {() => (
                  <div data-speaker-consents>
                    <p class="pk-muted pk-small">Loading required terms…</p>
                  </div>
                )}
              </Field>
            </form>
          </div>
          <p class="pk-alert pk-alert--ok" data-confirmed-msg hidden>
            You have confirmed your participation. Thank you!
          </p>
          <p class="pk-alert pk-alert--danger" data-declined-msg hidden>
            You have declined participation in this session.
          </p>
        </div>
        <div class="pk-stack pk-stack--snug" data-profile-section hidden>
          <h4>Your speaker profile</h4>
          <div class="pk-alert pk-alert--ok" data-profile-saved-state role="status" hidden>
            <div class="pk-cluster pk-cluster--between">
              <p>Speaker identity saved.</p>
              <Button type="button" variant="secondary" data-profile-edit>
                Change speaker identity
              </Button>
            </div>
          </div>
          <div data-profile-form-wrap>
            <form data-profile-form class="pk-form pk-stack--loose" noValidate>
              <div data-speaker-identity />
              {/* Shown once there is something to save: a recorded identity, or one just confirmed by email. */}
              <div class="pk-cluster" data-profile-save>
                <Button type="submit">Save speaker identity</Button>
              </div>
            </form>
          </div>
          {/* The profile of the identity chosen above, edited on the identity itself. */}
          <div class="pk-stack pk-stack--snug" data-identity-profile hidden>
            <h5>Your profile as this identity</h5>
            <p class="pk-muted">
              Shown with your session on the event program, and wherever else you appear as this identity.
            </p>
            <div data-identity-profile-form />
          </div>
        </div>
        <div class="pk-stack pk-stack--snug" data-headshot-section hidden>
          <h4>Your photo</h4>
          <p class="pk-muted">
            Add a professional headshot photo. It will appear on the event website alongside your session.
          </p>
          {/* The photo tile is rendered here by the page module. */}
          <div data-headshot-tile />
          <p data-headshot-status class="pk-muted pk-small" role="status" />
        </div>
        <div class="pk-stack pk-stack--snug" data-participation-actions hidden>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" form="speaker-participation-confirm" data-confirm-participation>
              Confirm participation
            </Button>
          </div>
          {/* Declining is a separate decision, kept apart from the main action. */}
          <div class="pk-stack pk-stack--tight">
            <p class="pk-muted pk-small">Unable to take part in this session?</p>
            <div class="pk-cluster">
              <Button type="button" variant="danger-quiet" data-decline-open>
                Decline participation…
              </Button>
            </div>
          </div>
          <div class="pk-stack pk-stack--snug" data-decline-panel hidden>
            <Field id="decline-reason" label="Reason (optional)">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={2000}
                  placeholder="Let the proposer know why you cannot participate…"
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button type="button" variant="danger" data-decline-confirm>
                Decline participation
              </Button>
              <Button type="button" variant="secondary" data-decline-cancel>
                Keep participating
              </Button>
            </div>
          </div>
        </div>
        <div class="pk-stack pk-stack--snug" data-presentation-link hidden>
          <p class="pk-muted">
            Your proposal has been accepted. When your profile is complete, you can upload your presentation slides.
          </p>
          <p>
            <ButtonLink href="presentation/">Go to presentation upload →</ButtonLink>
          </p>
        </div>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </div>
      <HeadshotDialogTemplates />
    </div>
  );
}
