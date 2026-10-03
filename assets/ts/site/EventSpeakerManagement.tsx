import { Field } from "../ui/Field";
import { TextInput, Textarea } from "../ui/TextControl";
import { Button, ButtonLink } from "../ui/Button";
import { EventPersonalFields } from "./EventPersonalFields";
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
      <div data-speaker-content class="pk-stack pk-stack--loose" hidden>
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
              the proposal, you'll be asked to upload a bio, headshot, and your presentation.
            </p>
            <form data-confirm-form class="pk-grid" noValidate>
              <Field group label="Speaker terms and conditions" errorSlot="consents">
                {() => (
                  <div data-speaker-consents>
                    <p class="pk-muted pk-small">Loading required terms…</p>
                  </div>
                )}
              </Field>
              <div class="pk-cluster">
                <Button type="submit">Confirm participation</Button>
                <Button type="button" variant="secondary" data-decline-open>
                  Decline
                </Button>
              </div>
            </form>
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
              <Button type="button" variant="danger" size="sm" data-decline-confirm>
                Confirm — I cannot participate
              </Button>
              <Button type="button" variant="secondary" size="sm" data-decline-cancel>
                Go back
              </Button>
            </div>
          </div>
          <p class="pk-alert pk-alert--ok" data-confirmed-msg hidden>
            You have confirmed your participation. Thank you!
          </p>
          <p class="pk-alert pk-alert--danger" data-declined-msg hidden>
            You have declined participation in this session.
          </p>
        </div>
        <div class="pk-stack pk-stack--snug" data-headshot-section hidden>
          <h4>Your photo</h4>
          <p class="pk-muted">
            Upload a professional headshot photo. It will appear on the event website alongside your session.
          </p>
          <div data-headshot-preview class="pkic-speaker-headshot-preview" />
          <p data-headshot-status class="pk-muted pk-small" />
          <Field id="speaker-headshot-file" label="Upload photo">
            {(control) => (
              <TextInput {...control} type="file" accept="image/jpeg,image/png,image/webp" data-headshot-file />
            )}
          </Field>
          <Button type="button" size="sm" variant="secondary" data-headshot-delete hidden>
            Remove photo
          </Button>
        </div>
        <div class="pk-stack pk-stack--snug" data-profile-section hidden>
          <h4>Bio &amp; links</h4>
          <div class="pk-alert pk-alert--ok" data-profile-saved-state hidden>
            <div class="pk-cluster pk-cluster--between">
              <p>Profile saved.</p>
              <Button type="button" size="sm" variant="secondary" data-profile-edit>
                Edit profile
              </Button>
            </div>
          </div>
          <div data-profile-form-wrap>
            <form data-profile-form class="pk-grid" noValidate>
              <EventPersonalFields prefix="speaker" />
              <Field
                id="speaker-bio"
                label="Biography"
                help="Visible to attendees on the event program."
                errorSlot="biography"
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="biography"
                    rows={5}
                    maxLength={10000}
                    placeholder="A short professional bio for the program and website…"
                  />
                )}
              </Field>
              <div data-profile-links-container />
              <div class="pk-cluster">
                <Button type="submit" size="sm">
                  Save profile
                </Button>
              </div>
            </form>
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
