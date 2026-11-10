/**
 * What a screen shows: a room of its event, one output there and, for an
 * output the overlay draws, the layout. Shared by pairing and editing so both
 * say an assignment the same way.
 */
import type { z } from "zod";
import { liveOverlayLayoutChoices } from "../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_SCREEN_OUTPUTS,
  LIVE_SCREEN_OUTPUT_DETAILS,
  screenOutputUsesOverlay,
  type LiveScreenOutput,
} from "../../../../../../../shared/live-room-outputs";
import { agendaRoomsListSchema } from "../../../../../../../shared/schemas/event-agenda-room-list";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { Field } from "../../../../../../ui/Field";
import { FormSection } from "../../../../../../ui/FormSection";
import { Select } from "../../../../../../ui/TextControl";

type AgendaRoomsList = z.infer<typeof agendaRoomsListSchema>;
type AgendaRoom = AgendaRoomsList["rooms"][number];

/** The built-in layouts, the ones every event has. */
const SCREEN_LAYOUT_CHOICES = liveOverlayLayoutChoices([]);

export interface ScreenAssignmentDraft {
  roomId: string;
  roomName: string;
  output: LiveScreenOutput | "";
  layout: string;
}

export const EMPTY_SCREEN_ASSIGNMENT: ScreenAssignmentDraft = { roomId: "", roomName: "", output: "", layout: "" };

/** The body's `assignment`: null while neither a room nor an output is chosen, so the contract judges the rest. */
export function screenAssignmentBody(draft: ScreenAssignmentDraft): Record<string, unknown> | null {
  if (!draft.roomId && !draft.output) return null;
  const usesLayout = draft.output !== "" && screenOutputUsesOverlay(draft.output);
  return { roomId: draft.roomId, output: draft.output, layout: usesLayout && draft.layout ? draft.layout : null };
}

export function screenAssignmentDraft(assignment: ScreenRecord["assignment"]): ScreenAssignmentDraft {
  return assignment
    ? {
        roomId: assignment.roomId,
        roomName: assignment.roomName,
        output: assignment.output,
        layout: assignment.layout ?? "",
      }
    : EMPTY_SCREEN_ASSIGNMENT;
}

function isScreenOutput(value: string): value is LiveScreenOutput {
  return (LIVE_SCREEN_OUTPUTS as readonly string[]).includes(value);
}

export function ScreenAssignmentFields({
  slug,
  draft,
  fields,
  onChange,
  load,
}: {
  slug: string;
  draft: ScreenAssignmentDraft;
  fields: (name: string) => FieldPresentation;
  onChange: (patch: Partial<ScreenAssignmentDraft>) => void;
  load?: CollectionLoader;
}) {
  const showsLayout = draft.output !== "" && screenOutputUsesOverlay(draft.output);
  const rooms = {
    endpoint: `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms`,
    responseSchema: agendaRoomsListSchema,
    resolveItems: (response: AgendaRoomsList) => response.rooms,
    resolvePage: (response: AgendaRoomsList) => response.page,
    itemKey: (room: AgendaRoom) => room.id,
    itemLabel: (room: AgendaRoom) => room.name,
    sort: "name",
  };
  return (
    <FormSection title="What it shows">
      <Field label="Room" {...fields("assignment.roomId")}>
        {(control) => (
          <ServerSearchSelect
            {...control}
            name="assignment.roomId"
            catalog={rooms}
            searchLabel="Rooms"
            placeholder="Not assigned"
            value={draft.roomId || null}
            selectedLabel={draft.roomName}
            load={load}
            onChange={(room) => onChange({ roomId: room?.id ?? "", roomName: room?.name ?? "" })}
          />
        )}
      </Field>
      <Field label="Output" {...fields("assignment.output")}>
        {(control) => (
          <Select
            {...control}
            name="assignment.output"
            value={draft.output}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onChange({ output: isScreenOutput(value) ? value : "" });
            }}
          >
            <option value="">Choose an output</option>
            {LIVE_SCREEN_OUTPUTS.map((output) => (
              <option key={output} value={output}>
                {LIVE_SCREEN_OUTPUT_DETAILS[output].label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {showsLayout && (
        <Field label="Layout" {...fields("assignment.layout")}>
          {(control) => (
            <Select
              {...control}
              name="assignment.layout"
              value={draft.layout}
              onChange={(event) => onChange({ layout: event.currentTarget.value })}
            >
              <option value="">Event default</option>
              {SCREEN_LAYOUT_CHOICES.map((layout) => (
                <option key={layout.slug} value={layout.slug}>
                  {layout.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </FormSection>
  );
}
