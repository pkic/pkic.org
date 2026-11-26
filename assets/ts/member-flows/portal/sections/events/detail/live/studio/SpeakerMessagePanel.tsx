import { useState } from "preact/hooks";
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
import { Field } from "../../../../../../../ui/Field";
import { IconBolt, IconChevron } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { TextInput } from "../../../../../../../ui/TextControl";
import "../../../../../../../ui/ButtonToggle.css";
import "../live-tally.css";
import "../../../../../../../live-session/LiveSpeakerMessageTones.css";
import "./SpeakerMessagePanel.css";

type Draft = { text: string; tone: LiveSpeakerMessageTone; flash: boolean };
type StageMessage = { text: string | null; tone: LiveSpeakerMessageTone; flash: boolean };

/** The composer's draft, shared by the panel's header (Edit) and its body. */
export interface SpeakerMessageDraft {
  draft: Draft;
  change: (patch: Partial<Draft>) => void;
}

export function useSpeakerMessageDraft(): SpeakerMessageDraft {
  const [draft, setDraft] = useState<Draft>({ text: "", tone: "neutral", flash: false });
  return { draft, change: (patch) => setDraft((current) => ({ ...current, ...patch })) };
}

/** The tone's own color, as the stage display draws it. */
function ToneSwatch({ tone }: { tone: LiveSpeakerMessageTone }) {
  return <span class="pk-studio-message__swatch" data-speaker-tone={tone} aria-hidden="true" />;
}

/**
 * What the stage display shows now, in the panel's header: Off, or the
 * message with Clear. The words put the message back in the composer to edit;
 * a flashing message also offers to stop it.
 */
export function SpeakerMessageStatus({
  message,
  send,
  disabled,
  draft,
}: {
  message: LiveSpeakerMessage | null;
  send: (message: LiveRoomClientMessage) => boolean;
  disabled: boolean;
  draft: SpeakerMessageDraft;
}) {
  if (!message)
    return (
      <span class="pk-studio-message__status" role="status" title="No message on the stage display">
        Off
      </span>
    );
  const onStage = (next: StageMessage) => send({ type: "speaker.message", ...next });
  const shown = message.flash ? "On stage, flashing" : "On stage";
  return (
    <span class="pk-studio-message__status" role="status">
      <Button
        variant="ghost"
        class="pk-studio-message__showing"
        disabled={disabled}
        aria-label={`${shown}: ${message.text}. Edit`}
        title={`${shown}: ${message.text}\nPut it back in the message box to edit. The stage keeps showing it until you send again.`}
        onClick={() => draft.change({ text: message.text, tone: message.tone, flash: message.flash })}
      >
        <ToneSwatch tone={message.tone} />
        <span class="pk-studio-message__showing-text">{message.text}</span>
      </Button>
      {message.flash ? (
        <Button
          variant="ghost"
          icon
          aria-label="Stop flashing"
          aria-pressed
          title={"Stop flashing\nThe message stays on stage, without the pulse."}
          disabled={disabled}
          onClick={() => onStage({ text: message.text, tone: message.tone, flash: false })}
        >
          <IconBolt />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        disabled={disabled}
        title={"Clear from stage\nThe stage display shows no message."}
        onClick={() => onStage({ text: null, tone: message.tone, flash: false })}
      >
        Clear
      </Button>
    </span>
  );
}

/**
 * A short message for the speaker on the stage display. One rule throughout:
 * the composer is a draft — its words, tone, flash and the ready-made
 * messages only fill it — and nothing reaches the stage until Send, or
 * Update while a message shows. The header acts on what is on stage now.
 */
export function SpeakerMessagePanel({
  message,
  send,
  disabled,
  draft: { draft, change },
}: {
  message: LiveSpeakerMessage | null;
  send: (message: LiveRoomClientMessage) => boolean;
  disabled: boolean;
  draft: SpeakerMessageDraft;
}) {
  const form = useContractForm(liveSpeakerMessageInputSchema, draft);
  const unchanged =
    message !== null &&
    message.text === draft.text.trim() &&
    message.tone === draft.tone &&
    message.flash === draft.flash;
  const toneLabel = LIVE_SPEAKER_MESSAGE_TONE_LABELS[draft.tone];
  return (
    <form
      class="pk-studio-message"
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        const checked = form.submit();
        if (checked.data && send({ type: "speaker.message", ...checked.data })) {
          change({ text: "", flash: false });
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
            title={`${preset.text}\nPut it in the message box to edit. It reaches the speaker when you send it.`}
            onClick={() => change({ text: preset.text, tone: preset.tone })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <Field label="Message to the speaker" labelHidden {...form.of("text")}>
        {(control) => (
          <div class="pk-studio-message__group">
            <TextInput
              {...control}
              name="text"
              value={draft.text}
              placeholder="Type a message…"
              autocomplete="off"
              onInput={(event) => change({ text: event.currentTarget.value })}
            />
            <Menu
              label={`Tone: ${toneLabel}`}
              title={`Tone: ${toneLabel}\nThe color the stage display shows the message in.`}
              variant="plain"
              triggerClass="pk-studio-message__tone"
              disabled={disabled}
              items={LIVE_SPEAKER_MESSAGE_TONES.map((tone) => ({
                id: tone,
                label: LIVE_SPEAKER_MESSAGE_TONE_LABELS[tone],
                icon: <ToneSwatch tone={tone} />,
                checked: draft.tone === tone,
                onSelect: () => change({ tone }),
              }))}
            >
              <ToneSwatch tone={draft.tone} />
              <IconChevron pointing="down" class="pk-studio-message__tone-chevron" />
            </Menu>
            <Button
              icon
              aria-label="Flash"
              aria-pressed={draft.flash}
              title={`Flash: ${draft.flash ? "on" : "off"}\nPulses on stage until stopped.`}
              disabled={disabled}
              onClick={() => change({ flash: !draft.flash })}
            >
              <IconBolt />
            </Button>
            <Button type="submit" variant="primary" disabled={disabled || unchanged}>
              {message ? "Update" : "Send"}
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}
