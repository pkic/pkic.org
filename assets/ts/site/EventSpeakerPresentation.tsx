import { SpeakerLinkRecovery } from "./SpeakerLinkRecovery";

/** Existing presentation links continue in the event app. */
export function EventSpeakerPresentation() {
  return (
    <div
      class="event-flow pk"
      data-event-speaker-presentation
      data-api-base="/api/v1"
      data-module="event-flows/speaker-presentation-page"
    >
      <form hidden>
        <div data-flow-status />
      </form>
      <SpeakerLinkRecovery />
      <p data-speaker-loading class="pk-muted pk-small">
        Opening your speaker participation…
      </p>
    </div>
  );
}
