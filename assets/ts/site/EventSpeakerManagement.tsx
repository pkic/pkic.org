import { SpeakerLinkRecovery } from "./SpeakerLinkRecovery";

/** Existing speaker links continue in the event app. */
export function EventSpeakerManagement() {
  return (
    <div
      class="event-flow pk"
      data-event-speaker-manage
      data-api-base="/api/v1"
      data-module="event-flows/speaker-manage-page"
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
