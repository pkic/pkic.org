/**
 * The studio's Message to speaker panel, drawn through its own components:
 * nothing on the stage display, and a flashing message showing.
 */
import type { PreviewSection } from "./PreviewShell";
import type { LiveSpeakerMessage } from "../../../shared/schemas/live-session-room";
import {
  SpeakerMessagePanel,
  SpeakerMessageStatus,
  useSpeakerMessageDraft,
} from "../../member-flows/portal/sections/events/detail/live/studio/SpeakerMessagePanel";
import { Panel } from "../Panel";
import { SectionHeading } from "../SectionHeading";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import "./event-screens-preview.css";

const send = () => true;

function MessageSpecimen({ message }: { message: LiveSpeakerMessage | null }) {
  const draft = useSpeakerMessageDraft();
  return (
    <div data-density="compact" class="pk-preview__studio-panel">
      <Panel class="pk-studio-panel" aria-label="Message to speaker">
        <header class="pk-studio-panel__header">
          <SectionHeading level={3} class="pk-studio-panel__title">
            Message to speaker
          </SectionHeading>
          <span class="pk-studio-panel__actions">
            <SpeakerMessageStatus message={message} send={send} disabled={false} draft={draft} />
          </span>
        </header>
        <div class="pk-studio-panel__body">
          <SpeakerMessagePanel message={message} send={send} disabled={false} draft={draft} />
        </div>
      </Panel>
    </div>
  );
}

export const studioSpeakerMessageSections: PreviewSection[] = [
  {
    id: "studio-speaker-message",
    title: "Studio: message to speaker",
    note: "Two rows: ready-made messages with their full words in the tooltip, then the message box with its tone, Flash and Send. The header says what the stage display shows: Off, or the message with Clear; its words put it back in the box to edit.",
    render: () => (
      <div class="pk-stack">
        <MessageSpecimen message={null} />
        <MessageSpecimen message={{ text: "Please wrap up", tone: "warning", flash: true, change: null }} />
      </div>
    ),
  },
];
