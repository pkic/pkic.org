import { ALLOWED_PRESENTATION_MIME_TYPES } from "../../shared/presentation-upload";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { Button } from "../ui/Button";
import { SpeakerLinkRecovery } from "./SpeakerLinkRecovery";
import { HeadshotDialogTemplates } from "./HeadshotDialogTemplates";

/** Static upload controls; acceptance and upload authorization stay in the API. */
export function EventSpeakerPresentation() {
  return (
    <div
      class="event-flow pk"
      data-event-speaker-presentation
      data-api-base="/api/v1"
      data-module="event-flows/speaker-presentation-page"
    >
      <SpeakerLinkRecovery />
      <p data-speaker-loading class="pk-muted pk-small">
        Loading your presentation details…
      </p>
      <div data-not-accepted-section hidden>
        <p class="pk-muted pk-small">
          Presentation upload is only available once your proposal has been accepted and you have confirmed your
          participation.
        </p>
      </div>
      <div data-speaker-content class="pk-stack pk-stack--loose" hidden>
        <div class="pk-stack pk-stack--tight" data-proposal-summary>
          <h3 data-proposal-title />
          <p class="pk-small" data-presentation-deadline-row />
        </div>
        <div class="pk-stack pk-stack--snug">
          <h4>Presentation upload</h4>
          <p class="pk-small" data-presentation-status-msg />
          <p class="pk-alert pk-alert--info" data-cospeaker-upload-notice hidden />
          <div class="pk-cluster" data-presentation-upload-controls>
            <Button type="button" variant="secondary" size="sm" data-presentation-upload-label>
              Upload presentation
            </Button>
            <Field id="speaker-presentation-file" label="Presentation file">
              {(control) => (
                <TextInput
                  {...control}
                  type="file"
                  accept={ALLOWED_PRESENTATION_MIME_TYPES.join(",")}
                  data-presentation-file
                />
              )}
            </Field>
          </div>
          <p data-presentation-upload-status class="pk-muted pk-small" />
        </div>
      </div>
      <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      <form hidden noValidate />
      <HeadshotDialogTemplates />
    </div>
  );
}
