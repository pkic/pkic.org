import { agendaMediaCapabilities, type AgendaMediaCapabilities } from "../../../../../../../shared/event-agenda-media";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";

function locationDefaults(room: AgendaSnapshot["rooms"][number] | undefined) {
  if (!room) return "Choose a location on the Schedule tab; this session then follows its planned media.";
  const media = agendaMediaCapabilities(room.equipment);
  const planned = [media.recording && "Recording", media.liveStreaming && "Live streaming"].filter(Boolean);
  return `Using location defaults from ${room.name}: ${planned.length ? planned.join(", ") : "no recording or live streaming"} · ${room.virtualRoomUrl ?? "no virtual-room link"}`;
}

/**
 * Recording, live streaming and the virtual room are a location's arrangement. A session follows its
 * primary location unless the organizer overrides it here; the override then replaces all three.
 */
export function SessionMediaFields({
  room,
  override,
  onOverride,
  media,
  onMedia,
  virtualRoomUrl,
  onVirtualRoomUrl,
  equipment,
  onEquipment,
  of,
  disabled,
}: {
  room?: AgendaSnapshot["rooms"][number];
  override: boolean;
  onOverride: (value: boolean) => void;
  media: AgendaMediaCapabilities;
  onMedia: (value: AgendaMediaCapabilities) => void;
  virtualRoomUrl: string;
  onVirtualRoomUrl: (value: string) => void;
  equipment: string;
  onEquipment: (value: string) => void;
  of: (name: string) => FieldPresentation;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} class="pk-fieldset pk-stack">
      <Field
        label="Planned media"
        group
        help="Planned media are checked against the location's capabilities. They do not publish a recording."
        {...of("plannedMedia")}
      >
        {(control) => (
          <div class="pk-stack pk-stack--snug" aria-describedby={control["aria-describedby"]}>
            <p class="pk-agenda-editor__notice">{locationDefaults(room)}</p>
            <Checkbox
              name="plannedMedia"
              label="Override for this session"
              checked={override}
              onChange={(event) => onOverride(event.currentTarget.checked)}
            />
            {override && (
              <div class="pk-cluster">
                <Checkbox
                  name="plannedMedia.recording"
                  label="Recording planned"
                  checked={media.recording}
                  onChange={(event) => onMedia({ ...media, recording: event.currentTarget.checked })}
                />
                <Checkbox
                  name="plannedMedia.liveStreaming"
                  label="Live streaming planned"
                  checked={media.liveStreaming}
                  onChange={(event) => onMedia({ ...media, liveStreaming: event.currentTarget.checked })}
                />
              </div>
            )}
          </div>
        )}
      </Field>
      {override && (
        <Field
          label="Virtual-room link"
          help="Leave empty for no virtual room. Only authorized signed-in attendees can open it during the session; the public agenda never exposes this address."
          {...of("virtualRoomUrl")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="virtualRoomUrl"
              value={virtualRoomUrl}
              onInput={(event) => onVirtualRoomUrl(event.currentTarget.value)}
            />
          )}
        </Field>
      )}
      <Field
        label="Other required equipment"
        help="Separate items with commas. Moving this session checks that the location provides every item."
        {...of("requiredEquipment")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="requiredEquipment"
            value={equipment}
            onInput={(event) => onEquipment(event.currentTarget.value)}
          />
        )}
      </Field>
    </fieldset>
  );
}
