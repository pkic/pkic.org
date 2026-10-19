import { useId, useState } from "preact/hooks";
import {
  LIVE_SPEAKER_MESSAGE_PRESETS,
  LIVE_SPEAKER_MESSAGE_TONES,
  LIVE_SPEAKER_MESSAGE_TONE_LABELS,
  type LiveSpeakerMessageTone,
} from "../../../../../../../../shared/live-room-outputs";
import {
  liveSpeakerMessageInputSchema,
  type LiveRoomClientMessage,
  type LiveSpeakerMessage,
} from "../../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../../ui/Button";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Field } from "../../../../../../../ui/Field";
import { TextInput } from "../../../../../../../ui/TextControl";
import "../../../../../../../ui/ButtonToggle.css";
import "../live-tally.css";
import "../../../../../../../live-session/LiveSpeakerMessageTones.css";
import { useScrollEdges } from "./useScrollEdges";
import "./SpeakerMessagePanel.css";

type Draft = { text: string; tone: LiveSpeakerMessageTone; flash: boolean };

/**
 * A short message for the speaker on the stage display. One rule throughout:
 * the composer is a draft — its words, tone, flash and the ready-made
 * messages only fill it — and nothing reaches the stage until Send, or
 * Update while a message shows. The footer acts on what is on stage now, and
 * says so: stop or start its flash, or clear it.
 */
export function SpeakerMessagePanel({
  message,
  send,
  disabled,
}: {
  message: LiveSpeakerMessage | null;
  send: (message: LiveRoomClientMessage) => boolean;
  disabled: boolean;
}) {
  const toneLabel = useId();
  const composer = useScrollEdges<HTMLFormElement>();
  const [draft, setDraft] = useState<Draft>({ text: "", tone: message?.tone ?? "neutral", flash: false });
  const form = useContractForm(liveSpeakerMessageInputSchema, draft);
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const onStage = (next: { text: string | null; tone: LiveSpeakerMessageTone; flash: boolean }) =>
    send({ type: "speaker.message", ...next });
  const unchanged =
    message !== null &&
    message.text === draft.text.trim() &&
    message.tone === draft.tone &&
    message.flash === draft.flash;
  return (
    <div class="pk-studio-message">
      <form
        ref={composer}
        class="pk-studio-message__body pk-scroll-edges"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          const checked = form.submit();
          if (checked.data && onStage(checked.data)) {
            setDraft((current) => ({ ...current, text: "", flash: false }));
            form.reset();
          }
        }}
      >
        <div class="pk-studio-message__presets" role="group" aria-label="Ready-made messages, to edit before sending">
          {LIVE_SPEAKER_MESSAGE_PRESETS.map((preset) => (
            <Button
              key={preset.text}
              variant="ghost"
              class="pk-studio-message__preset"
              data-speaker-tone={preset.tone}
              disabled={disabled}
              aria-pressed={draft.text === preset.text}
              onClick={() => change({ text: preset.text, tone: preset.tone })}
            >
              {preset.text}
            </Button>
          ))}
        </div>
        <Field label="Message" {...form.of("text")}>
          {(control) => (
            <div class="pk-studio-message__group">
              <TextInput
                {...control}
                name="text"
                value={draft.text}
                autocomplete="off"
                onInput={(event) => change({ text: event.currentTarget.value })}
              />
              <Button type="submit" variant="primary" disabled={disabled || unchanged}>
                {message ? "Update message" : "Send to stage"}
              </Button>
            </div>
          )}
        </Field>
        <div class="pk-studio-message__options">
          <div class="pk-segmented" role="group" aria-labelledby={toneLabel}>
            <span class="pk-sr-only" id={toneLabel}>
              Tone
            </span>
            {LIVE_SPEAKER_MESSAGE_TONES.map((option) => (
              <Button
                key={option}
                class="pk-studio-message__tone-option"
                data-speaker-tone={option}
                aria-pressed={draft.tone === option}
                disabled={disabled}
                onClick={() => change({ tone: option })}
              >
                <span class="pk-studio-message__swatch" aria-hidden="true" />
                {LIVE_SPEAKER_MESSAGE_TONE_LABELS[option]}
              </Button>
            ))}
          </div>
          <Checkbox
            label="Flash"
            hint="Pulses on stage until stopped"
            checked={draft.flash}
            disabled={disabled}
            onChange={(event) => change({ flash: event.currentTarget.checked })}
          />
        </div>
      </form>
      <div class="pk-studio-message__live" role="status" data-speaker-tone={message?.tone}>
        {message ? (
          <>
            <span class="pk-studio-message__state">On stage</span>
            <span class="pk-studio-message__text">
              {message.text}
              {message.flash ? <span class="pk-studio-message__flashing"> · Flashing</span> : null}
            </span>
            <Button
              variant="ghost"
              disabled={disabled}
              title="Put the message on stage back in the composer"
              onClick={() => setDraft({ text: message.text, tone: message.tone, flash: message.flash })}
            >
              Edit
            </Button>
            <Button
              aria-pressed={message.flash}
              disabled={disabled}
              onClick={() => onStage({ text: message.text, tone: message.tone, flash: !message.flash })}
            >
              {message.flash ? "Stop flashing" : "Flash"}
            </Button>
            <Button disabled={disabled} onClick={() => onStage({ text: null, tone: message.tone, flash: false })}>
              Clear from stage
            </Button>
          </>
        ) : (
          <span class="pk-muted">Nothing on the stage display.</span>
        )}
      </div>
    </div>
  );
}
