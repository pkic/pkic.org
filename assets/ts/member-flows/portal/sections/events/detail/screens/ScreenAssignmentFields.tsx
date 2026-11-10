/**
 * What a screen shows: a room of its event, one output there and, for an
 * output the overlay draws, the layout. Shared by pairing and editing so both
 * say an assignment the same way.
 */
import {
  LIVE_SCREEN_OUTPUTS,
  LIVE_SCREEN_OUTPUT_DETAILS,
  screenOutputUsesOverlay,
  type LiveScreenOutput,
} from "../../../../../../../shared/live-room-outputs";
import type { ScreenAssignmentInput } from "../../../../../../../shared/schemas/event-screens";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { FormSection } from "../../../../../../ui/FormSection";
import { Select } from "../../../../../../ui/TextControl";

export interface ScreenRoomChoice {
  id: string;
  name: string;
}

export interface ScreenLayoutChoice {
  slug: string;
  name: string;
}

export interface ScreenAssignmentDraft {
  roomId: string;
  output: LiveScreenOutput | "";
  layout: string;
}

export const EMPTY_SCREEN_ASSIGNMENT: ScreenAssignmentDraft = { roomId: "", output: "", layout: "" };

/** The body's `assignment`: null while neither a room nor an output is chosen, so the contract judges the rest. */
export function screenAssignmentBody(draft: ScreenAssignmentDraft): Record<string, unknown> | null {
  if (!draft.roomId && !draft.output) return null;
  const usesLayout = draft.output !== "" && screenOutputUsesOverlay(draft.output);
  return { roomId: draft.roomId, output: draft.output, layout: usesLayout && draft.layout ? draft.layout : null };
}

export function screenAssignmentDraft(assignment: ScreenAssignmentInput | null): ScreenAssignmentDraft {
  return assignment
    ? { roomId: assignment.roomId, output: assignment.output, layout: assignment.layout ?? "" }
    : EMPTY_SCREEN_ASSIGNMENT;
}

function isScreenOutput(value: string): value is LiveScreenOutput {
  return (LIVE_SCREEN_OUTPUTS as readonly string[]).includes(value);
}

export function ScreenAssignmentFields({
  draft,
  rooms,
  layouts,
  fields,
  onChange,
}: {
  draft: ScreenAssignmentDraft;
  rooms: readonly ScreenRoomChoice[];
  layouts: readonly ScreenLayoutChoice[];
  fields: (name: string) => FieldPresentation;
  onChange: (patch: Partial<ScreenAssignmentDraft>) => void;
}) {
  const showsLayout = draft.output !== "" && screenOutputUsesOverlay(draft.output);
  return (
    <FormSection title="What it shows">
      <Field label="Room" {...fields("assignment.roomId")}>
        {(control) => (
          <Select
            {...control}
            name="assignment.roomId"
            value={draft.roomId}
            onChange={(event) => onChange({ roomId: event.currentTarget.value })}
          >
            <option value="">Not assigned</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
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
              {layouts.map((layout) => (
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
