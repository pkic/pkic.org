import {
  agendaMediaCapabilities,
  withoutAgendaMediaEquipment,
  withAgendaMediaCapabilities,
} from "../../../../../../../shared/event-agenda-media";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";

/** Media plans share the existing equipment request; the virtual-room link is a separate authored field. */
export function SessionMediaFields({
  equipment,
  onEquipment,
  virtualRoomUrl,
  onVirtualRoomUrl,
  of,
  disabled,
}: {
  equipment: string;
  onEquipment: (value: string) => void;
  virtualRoomUrl: string;
  onVirtualRoomUrl: (value: string) => void;
  of: (name: string) => FieldPresentation;
  disabled: boolean;
}) {
  const items = equipment
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const media = agendaMediaCapabilities(items);
  return (
    <fieldset disabled={disabled} class="pk-fieldset pk-stack">
      <Field
        label="Planned media"
        group
        help="These requirements are checked against the location's capabilities. They do not publish a recording."
        {...of("requiredEquipment")}
      >
        {(control) => (
          <div class="pk-cluster" aria-describedby={control["aria-describedby"]}>
            <Checkbox
              name="requiredEquipment"
              label="Recording planned"
              checked={media.recording}
              onChange={(event) =>
                onEquipment(
                  withAgendaMediaCapabilities(items, { ...media, recording: event.currentTarget.checked }).join(", "),
                )
              }
            />
            <Checkbox
              name="requiredEquipment"
              label="Live streaming planned"
              checked={media.liveStreaming}
              onChange={(event) =>
                onEquipment(
                  withAgendaMediaCapabilities(items, { ...media, liveStreaming: event.currentTarget.checked }).join(
                    ", ",
                  ),
                )
              }
            />
          </div>
        )}
      </Field>
      <Field
        label="Other required equipment"
        help="Separate items with commas. Moving this session checks that the location provides every item."
        {...of("requiredEquipment")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="requiredEquipment"
            value={withoutAgendaMediaEquipment(items).join(", ")}
            onInput={(event) =>
              onEquipment(
                withAgendaMediaCapabilities(
                  event.currentTarget.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  media,
                ).join(", "),
              )
            }
          />
        )}
      </Field>
      <Field
        label="Virtual-room link"
        help="Only authorized signed-in attendees can access this destination during the scheduled interval. The public agenda links to sign-in and never exposes this address."
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
    </fieldset>
  );
}
