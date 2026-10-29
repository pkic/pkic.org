import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { DataTable } from "../../../../ui/DataTable";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { Button } from "../../../../ui/Button";
import { AttendanceIcon } from "../../../../components/AttendanceIcon";
import { IconRemove } from "../../../../components/icons";
import { attendanceIconSchema, ATTENDANCE_ICON_LABELS } from "../../../../../shared/event-attendance-icons";
import { formatNumber } from "../../../../../shared/format-number";
import {
  optionFieldPrefix,
  optionInUse,
  type AttendanceDefinition,
  type AttendanceSettingsDraft,
} from "./event-attendance-draft";

interface AttendanceOptionsBase {
  draft: AttendanceSettingsDraft;
  phone: boolean;
  expanded: string | null;
  onExpand: (id: string | null) => void;
}

export type AttendanceOptionsProps = AttendanceOptionsBase &
  (
    | { readOnly: true }
    | {
        readOnly?: false;
        field: (name: string) => FieldPresentation;
        onChange: (id: string, patch: Partial<AttendanceDefinition["option"]>) => void;
        onRemove: (id: string) => void;
      }
  );

function DefinitionField({
  definition,
  property,
  props,
}: {
  definition: AttendanceDefinition;
  property: "value" | "label" | "description" | "icon";
  props: AttendanceOptionsProps;
}) {
  const name = `${optionFieldPrefix(props.draft, definition.id)}.${property}`;
  const labels = { value: "Key", label: "Label", description: "Description", icon: "Icon" };
  if (props.readOnly)
    return (
      <span class={property === "value" ? "pk-mono" : undefined}>
        {property === "icon"
          ? definition.option.icon
            ? ATTENDANCE_ICON_LABELS[definition.option.icon]
            : "Automatic"
          : definition.option[property] || "—"}
      </span>
    );
  return (
    <Field
      {...props.field(name)}
      label={labels[property]}
      labelHidden={!props.phone}
      required={property === "value" || property === "label"}
    >
      {(control) =>
        property === "icon" ? (
          <Select
            {...control}
            name={name}
            value={definition.option.icon ?? ""}
            onChange={(event) =>
              props.onChange(definition.id, {
                icon: event.currentTarget.value ? attendanceIconSchema.parse(event.currentTarget.value) : undefined,
              })
            }
          >
            <option value="">Automatic</option>
            {attendanceIconSchema.options.map((icon) => (
              <option key={icon} value={icon}>
                {ATTENDANCE_ICON_LABELS[icon]}
              </option>
            ))}
          </Select>
        ) : (
          <TextInput
            {...control}
            name={name}
            value={definition.option[property] ?? ""}
            readOnly={property === "value" && optionInUse(props.draft, definition)}
            class={property === "value" ? "pk-mono" : undefined}
            onInput={(event) => props.onChange(definition.id, { [property]: event.currentTarget.value })}
          />
        )
      }
    </Field>
  );
}

function RemoveOption({ definition, props }: { definition: AttendanceDefinition; props: AttendanceOptionsProps }) {
  if (props.readOnly) return null;
  const inUse = optionInUse(props.draft, definition);
  const label = inUse ? "In use by existing registrations" : `Remove ${definition.option.label || "attendance option"}`;
  return (
    <Button
      icon={!props.phone}
      variant="danger-quiet"
      disabled={inUse}
      aria-label={label}
      title={label}
      onClick={() => props.onRemove(definition.id)}
    >
      {props.phone ? label : <IconRemove width="16" height="16" />}
    </Button>
  );
}

export function EventAttendanceOptions(props: AttendanceOptionsProps) {
  if (!props.phone)
    return (
      <DataTable
        caption="Attendance options"
        narrowLayout="columns"
        rows={props.draft.definitions}
        rowKey={(definition) => definition.id}
        columns={[
          {
            id: "icon",
            header: "Icon",
            cell: (definition) => (
              <div class="pk-attendance-settings__icon-field">
                <AttendanceIcon type={definition.option.value} icon={definition.option.icon} />
                <DefinitionField definition={definition} property="icon" props={props} />
              </div>
            ),
          },
          {
            id: "label",
            header: "Label",
            cell: (definition) => <DefinitionField definition={definition} property="label" props={props} />,
          },
          {
            id: "key",
            header: "Key",
            cell: (definition) => <DefinitionField definition={definition} property="value" props={props} />,
          },
          {
            id: "description",
            header: "Description",
            cell: (definition) => <DefinitionField definition={definition} property="description" props={props} />,
          },
          ...(!props.readOnly
            ? [
                {
                  id: "remove",
                  header: "Actions",
                  headerHidden: true,
                  cell: (definition: AttendanceDefinition) => <RemoveOption definition={definition} props={props} />,
                },
              ]
            : []),
        ]}
      />
    );
  return (
    <div class="pk-attendance-settings__definitions">
      {props.draft.definitions.map((definition) => {
        const offered = props.draft.days.filter((day) => day.choices[definition.id]?.enabled).length;
        return (
          <details
            class="pk-attendance-settings__definition"
            key={definition.id}
            open={props.expanded === definition.id}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                props.onExpand(props.expanded === definition.id ? null : definition.id);
              }}
            >
              <AttendanceIcon type={definition.option.value} icon={definition.option.icon} />
              <span>
                <strong>{definition.option.label || "New option"}</strong>
                <span class="pk-mono pk-small pk-muted">{definition.option.value || "Choose a key"}</span>
              </span>
              <span class="pk-small pk-muted">
                {formatNumber(offered)}/{formatNumber(props.draft.days.length)} days
              </span>
            </summary>
            <div class="pk-stack pk-attendance-settings__definition-fields">
              {(["label", "value", "description", "icon"] as const).map((property) =>
                props.readOnly ? (
                  <div key={property} class="pk-stack pk-stack--tight">
                    <span class="pk-small pk-muted">
                      {{ label: "Label", value: "Key", description: "Description", icon: "Icon" }[property]}
                    </span>
                    <DefinitionField definition={definition} property={property} props={props} />
                  </div>
                ) : (
                  <DefinitionField key={property} definition={definition} property={property} props={props} />
                ),
              )}
              <RemoveOption definition={definition} props={props} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
