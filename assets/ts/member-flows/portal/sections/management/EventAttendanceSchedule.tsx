import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { Checkbox } from "../../../../ui/Checkbox";
import { Button } from "../../../../ui/Button";
import { DataTable } from "../../../../ui/DataTable";
import { Meter } from "../../../../ui/Meter";
import { TabList } from "../../../../ui/TabList";
import { IconPlus, IconRemove } from "../../../../components/icons";
import { AttendanceIcon } from "../../../../components/AttendanceIcon";
import { calendarDateParts, formatCalendarDate, formatDayAndMonth } from "../../../../../shared/format-date";
import { formatNumber } from "../../../../../shared/format-number";
import {
  dayOptionEntries,
  type AttendanceDayDraft,
  type AttendanceDefinition,
  type AttendanceSettingsDraft,
} from "./event-attendance-draft";

interface AttendanceScheduleBase {
  draft: AttendanceSettingsDraft;
  phone: boolean;
  zone: string;
  selectedDay: string;
  onSelectDay: (id: string) => void;
}

export type AttendanceScheduleProps = AttendanceScheduleBase &
  (
    | { readOnly: true }
    | {
        readOnly?: false;
        onAddDay: () => void;
        field: (name: string) => FieldPresentation;
        onDayChange: (id: string, patch: Partial<AttendanceDayDraft>) => void;
        onDayRemove: (id: string) => void;
        onChoiceChange: (
          dayId: string,
          definitionId: string,
          patch: Partial<AttendanceDayDraft["choices"][string]>,
        ) => void;
      }
  );

function DayFields({ day, index, props }: { day: AttendanceDayDraft; index: number; props: AttendanceScheduleProps }) {
  if (props.readOnly)
    return (
      <div class="pk-stack pk-stack--tight pk-attendance-settings__day-fields">
        <strong>{formatCalendarDate(day.date, "full")}</strong>
        {day.label && <span>{day.label}</span>}
        {(day.startTime || day.endTime) && (
          <span class="pk-small">{[day.startTime, day.endTime].filter(Boolean).join(" – ")}</span>
        )}
        {props.phone && <span class="pk-small pk-muted">Local time: {props.zone}</span>}
      </div>
    );
  const edit = props;
  function input(property: "date" | "label" | "startTime" | "endTime", label: string, type = "text") {
    const name = `configuration.days.${index}.${property}`;
    return (
      <Field {...edit.field(name)} label={label} labelHidden={!props.phone} required={property === "date"}>
        {(control) => (
          <TextInput
            {...control}
            name={name}
            type={type}
            value={day[property]}
            placeholder={property === "label" ? formatCalendarDate(day.date, "full") : undefined}
            aria-describedby={
              type === "time"
                ? [control["aria-describedby"], "attendance-times-zone"].filter(Boolean).join(" ")
                : control["aria-describedby"]
            }
            onInput={(event) => edit.onDayChange(day.id, { [property]: event.currentTarget.value })}
          />
        )}
      </Field>
    );
  }
  const inUse = Object.values(day.counts).some((count) => count > 0);
  return (
    <div class="pk-stack pk-stack--tight pk-attendance-settings__day-fields">
      <div class="pk-attendance-settings__date-row">
        {input("date", "Date", "date")}
        <Button
          icon
          variant="danger-quiet"
          disabled={inUse}
          aria-label={`Remove day ${formatNumber(index + 1)}`}
          title={inUse ? "This day has registrations" : `Remove day ${formatNumber(index + 1)}`}
          onClick={() => props.onDayRemove(day.id)}
        >
          <IconRemove width="16" height="16" />
        </Button>
      </div>
      {input("label", "Day label")}
      <div class="pk-attendance-settings__times">
        {input("startTime", "Starts at", "time")}
        {input("endTime", "Ends at", "time")}
      </div>
      {props.phone && <p class="pk-small pk-muted">Local time: {props.zone}</p>}
    </div>
  );
}

function CapacityCell({
  day,
  definition,
  index,
  props,
}: {
  day: AttendanceDayDraft;
  definition: AttendanceDefinition;
  index: number;
  props: AttendanceScheduleProps;
}) {
  const choice = day.choices[definition.id];
  const enabled = choice?.enabled ?? false;
  const registered = day.counts[definition.originalValue] ?? 0;
  const full = choice?.capacity != null && registered >= choice.capacity;
  const status = full ? (definition.option.value === "in_person" ? "Full · waitlist" : "Full") : "Open";
  const optionIndex = dayOptionEntries(props.draft, index).findIndex((entry) => entry.definition.id === definition.id);
  const name = `configuration.days.${index}.attendanceOptions.${optionIndex}.capacity`;
  return (
    <div
      class="pk-attendance-settings__capacity"
      data-unavailable={!enabled || undefined}
      data-full={(enabled && full) || undefined}
    >
      <div class="pk-cluster pk-cluster--between">
        {props.phone ? (
          <span class="pk-attendance-settings__option-name">
            <AttendanceIcon type={definition.option.value} icon={definition.option.icon} />
            <strong>{definition.option.label || "New option"}</strong>
          </span>
        ) : enabled ? (
          <span class="pk-small pk-attendance-settings__capacity-status">{status}</span>
        ) : (
          <span class="pk-small pk-muted">Not offered</span>
        )}
        {props.readOnly ? (
          props.phone && <span class="pk-small pk-muted">{enabled ? "Offered" : "Not offered"}</span>
        ) : props.phone ? (
          <Checkbox
            role="switch"
            checked={enabled}
            label={
              <span class="pk-sr-only">
                Offer {definition.option.label || "this option"} on {day.date || "this day"}
              </span>
            }
            onChange={() => props.onChoiceChange(day.id, definition.id, { enabled: !enabled })}
          />
        ) : (
          <Button variant="ghost" onClick={() => props.onChoiceChange(day.id, definition.id, { enabled: !enabled })}>
            {enabled ? "Turn off" : "+ Offer"}
          </Button>
        )}
      </div>
      {enabled && (
        <>
          {props.phone && <span class="pk-small pk-attendance-settings__capacity-status">{status}</span>}
          <div class="pk-attendance-settings__capacity-controls">
            {props.readOnly ? (
              <span class="pk-small">
                {choice.capacity == null
                  ? "Unlimited places"
                  : `${formatNumber(choice.capacity)} ${choice.capacity === 1 ? "place" : "places"}`}
              </span>
            ) : (
              <Field
                {...props.field(name)}
                label={`Capacity for ${definition.option.label || "this option"} on ${day.date || "this day"}`}
                labelHidden
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name={name}
                    type="number"
                    min="1"
                    value={choice.capacity ?? ""}
                    placeholder="Unlimited"
                    onInput={(event) =>
                      props.onChoiceChange(day.id, definition.id, {
                        capacity: event.currentTarget.value === "" ? null : event.currentTarget.valueAsNumber,
                      })
                    }
                  />
                )}
              </Field>
            )}
            <div class="pk-stack pk-stack--tight">
              {choice.capacity != null && (
                <Meter
                  label={`${definition.option.label} places used`}
                  value={registered}
                  max={choice.capacity}
                  tone={full ? "warn" : "accent"}
                />
              )}
              <span class="pk-small pk-muted">
                {formatNumber(registered)}
                {choice.capacity != null ? ` / ${formatNumber(choice.capacity)}` : ""} registered
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function EventAttendanceSchedule(props: AttendanceScheduleProps) {
  if (!props.phone)
    return (
      <DataTable
        caption="Schedule and capacity"
        narrowLayout="columns"
        rows={props.draft.days}
        rowKey={(day) => day.id}
        columns={[
          {
            id: "day",
            header: "Day",
            cell: (day) => <DayFields day={day} index={props.draft.days.indexOf(day)} props={props} />,
          },
          ...props.draft.definitions.map((definition) => ({
            id: definition.id,
            header: definition.option.label || "New option",
            headerContent: (
              <span class="pk-attendance-settings__column-name">
                <AttendanceIcon type={definition.option.value} icon={definition.option.icon} />
                {definition.option.label || "New option"}
              </span>
            ),
            cell: (day: AttendanceDayDraft) => (
              <CapacityCell day={day} definition={definition} index={props.draft.days.indexOf(day)} props={props} />
            ),
          })),
        ]}
      />
    );
  const index = Math.max(
    0,
    props.draft.days.findIndex((day) => day.id === props.selectedDay),
  );
  const day = props.draft.days[index];
  return (
    <div class="pk-stack pk-attendance-settings__phone-schedule">
      <div class="pk-attendance-settings__day-picker">
        <TabList
          label="Attendance day"
          activeId={props.selectedDay}
          onSelect={props.onSelectDay}
          items={props.draft.days.map((day, index) => ({
            id: day.id,
            label: day.date ? (
              <span>
                <strong>{calendarDateParts(day.date).weekday}</strong>
                <span>{formatDayAndMonth(day.date)}</span>
              </span>
            ) : (
              `Day ${formatNumber(index + 1)}`
            ),
          }))}
        />
        {!props.readOnly && (
          <Button icon aria-label="Add day" title="Add day" onClick={props.onAddDay}>
            <IconPlus width="16" height="16" />
          </Button>
        )}
      </div>
      {day && (
        <>
          <DayFields day={day} index={index} props={props} />
          <p class="pk-small pk-muted">Offered on this day</p>
          <div class="pk-attendance-settings__day-options">
            {props.draft.definitions.map((definition) => (
              <CapacityCell key={definition.id} day={day} definition={definition} index={index} props={props} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
