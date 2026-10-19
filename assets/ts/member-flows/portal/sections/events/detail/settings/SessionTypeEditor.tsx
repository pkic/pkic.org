import { slugify } from "../../../../../../../shared/slug";
import { sessionTypeName, type ProposalSessionType } from "../../../../../../../shared/proposal-session-types";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import "./SessionTypeEditor.css";

/**
 * The event's session types as editable rows. A saved type keeps its identifier, because sessions
 * and proposals already refer to it; a new type derives its identifier from its name until edited.
 */
export function SessionTypeEditor({
  sessionTypes,
  savedSessionTypes,
  fieldFor,
  durationPath,
  onChange,
}: {
  sessionTypes: ProposalSessionType[];
  savedSessionTypes: readonly ProposalSessionType[] | null | undefined;
  /** The settings form's field state, keyed by contract path. */
  fieldFor: (path: string) => FieldPresentation;
  /** The contract path of a row's duration; blank rows are omitted from the request. */
  durationPath: (index: number) => string;
  onChange: (sessionTypes: ProposalSessionType[]) => void;
}) {
  return (
    <>
      {sessionTypes.map((sessionType, index) => (
        // A row has no identity until it is named, so its position is
        // the only stable key available.
        <div key={index} class="pk-session-type-editor-row">
          <Field label="Name" {...fieldFor(durationPath(index).replace(/durationMinutes$/, "name"))}>
            {(control) => (
              <TextInput
                {...control}
                value={sessionType.name ?? sessionTypeName(sessionType)}
                onInput={(inputEvent) => {
                  const updated = [...sessionTypes];
                  const name = inputEvent.currentTarget.value;
                  const existing = savedSessionTypes?.some(
                    (type) => type.label === sessionType.label && type.label.trim(),
                  );
                  updated[index] = {
                    ...sessionType,
                    name,
                    ...(!existing && (!sessionType.label || sessionType.label === slugify(sessionType.name ?? ""))
                      ? { label: slugify(name) }
                      : {}),
                  };
                  onChange(updated);
                }}
              />
            )}
          </Field>
          <Field
            label={`Identifier ${String(index + 1)}`}
            {...fieldFor(durationPath(index).replace(/durationMinutes$/, "label"))}
          >
            {(control) => (
              <TextInput
                {...control}
                value={sessionType.label}
                readOnly={!!savedSessionTypes?.some((type) => type.label === sessionType.label && type.label.trim())}
                placeholder="e.g. talk, keynote, panel"
                onInput={(inputEvent) => {
                  const updated = [...sessionTypes];
                  updated[index] = {
                    ...updated[index],
                    label: (inputEvent.target as HTMLInputElement).value,
                  };
                  onChange(updated);
                }}
              />
            )}
          </Field>
          <Field label="Duration (minutes)" {...fieldFor(durationPath(index))}>
            {(control) => (
              <TextInput
                {...control}
                name={durationPath(index)}
                type="number"
                min={1}
                max={1440}
                step={1}
                value={sessionType.durationMinutes ?? ""}
                onInput={(inputEvent) => {
                  const value = inputEvent.currentTarget.value;
                  const updated = [...sessionTypes];
                  updated[index] = {
                    ...updated[index],
                    durationMinutes: value === "" ? undefined : Number(value),
                  };
                  onChange(updated);
                }}
              />
            )}
          </Field>
          <div class="pk-session-type-editor-row__actions">
            <Checkbox
              checked={sessionType.requiresPresentation}
              onChange={(changeEvent) => {
                const updated = [...sessionTypes];
                updated[index] = {
                  ...updated[index],
                  requiresPresentation: (changeEvent.target as HTMLInputElement).checked,
                };
                onChange(updated);
              }}
              label={<span class="pk-small">Requires presentation</span>}
            />
            <Button
              variant="danger-quiet"
              onClick={() => onChange(sessionTypes.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div class="pk-cluster">
        <Button onClick={() => onChange([...sessionTypes, { label: "", requiresPresentation: true }])}>
          + Add session type
        </Button>
      </div>
    </>
  );
}
