import { useLongPress } from "../../../../../../../hooks/useLongPress";
import { LIVE_SPEAKER_MESSAGE_PRESETS } from "../../../../../../../../shared/live-room-outputs";
import type { LiveRoomClientMessage } from "../../../../../../../../shared/schemas/live-session-room";
import { Button } from "../../../../../../../ui/Button";
import { LiveSpeakerCards } from "../LiveSpeakerCards";
import type { LiveTargets } from "../live-output-targets";
import "../../../../../../../live-session/LiveSpeakerMessageTones.css";
import "./StudioPhoneHome.css";

type Preset = (typeof LIVE_SPEAKER_MESSAGE_PRESETS)[number];

/** One ready-made message: a tap shows it on the stage display or clears it again, a hold flashes it. */
function MessageButton({
  preset,
  onStage,
  disabled,
  send,
}: {
  preset: Preset;
  onStage: boolean;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const show = (text: string | null, flash: boolean) =>
    send({ type: "speaker.message", text, tone: preset.tone, flash });
  const press = useLongPress(() => show(preset.text, true));
  return (
    <Button
      variant="ghost"
      class="pk-studio-home__chip"
      data-speaker-tone={preset.tone}
      disabled={disabled}
      aria-pressed={onStage}
      title="Tap to show on the stage display, tap again to clear. Hold to flash."
      {...press.handlers}
      onClick={() => {
        if (press.tapped()) show(onStage ? null : preset.text, false);
      }}
    >
      {preset.text}
    </Button>
  );
}

/**
 * The phone's first tab: actions only. The session's people with their
 * outputs, then the ready-made messages for the stage display. Preview,
 * Program, their Clear and the Transition stay in the bar above every tab.
 */
export function StudioPhoneHome({
  targets,
  send,
}: {
  targets: LiveTargets;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const message = targets.state.speakerMessage;
  return (
    <div class="pk-studio-home">
      <LiveSpeakerCards targets={targets} bare />
      <div class="pk-studio-home__chips" role="group" aria-label="Message to speaker">
        {LIVE_SPEAKER_MESSAGE_PRESETS.map((preset) => (
          <MessageButton
            key={preset.text}
            preset={preset}
            onStage={message?.text === preset.text}
            disabled={targets.disabled}
            send={send}
          />
        ))}
      </div>
    </div>
  );
}
