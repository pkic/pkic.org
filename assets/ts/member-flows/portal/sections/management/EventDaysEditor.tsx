import { useCallback, useState } from "preact/hooks";
import type { z } from "zod";
import type { EventAttendanceOption } from "../../../../../shared/schemas/event-configuration";
import {
  groupEventDaysReplaceResponseSchema,
  groupEventDaysReplaceSchema,
  groupEventDaysResponseSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import { useContractForm, type FieldPresentation } from "../../../../hooks/useContractForm";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Menu } from "../../../../ui/Menu";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import "../../../../ui/Content.css";

type DaysResponse = z.infer<typeof groupEventDaysResponseSchema>;

interface DayState {
  id?: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  attendanceOptions: EventAttendanceOption[];
}

function path(groupId: string, eventId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/days`;
}

/**
 * One attendance option.
 *
 * The remove control carries its ordinal rather than the word "Remove" alone:
 * a day can hold twenty of these, and twenty identically named buttons are
 * indistinguishable to anyone reading the form control by control.
 */
function AttendanceOptionRow({
  ordinal,
  prefix,
  field,
  option,
  onChange,
  onRemove,
}: {
  ordinal: number;
  prefix: string;
  field: (name: string) => FieldPresentation;
  option: EventAttendanceOption;
  onChange: (option: EventAttendanceOption) => void;
  onRemove: () => void;
}) {
  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-grid pk-grid--tight">
        <Field
          {...field(`${prefix}.value`)}
          label="Value"
          required
          help="Lowercase key stored with the registration, such as in_person."
        >
          {(control) => (
            <TextInput
              {...control}
              name={`${prefix}.value`}
              class="pk-mono"
              autocomplete="off"
              value={option.value}
              onInput={(event) => onChange({ ...option, value: event.currentTarget.value })}
              placeholder="in_person"
            />
          )}
        </Field>
        <Field
          {...field(`${prefix}.label`)}
          label="Label"
          required
          help="What an attendee sees when choosing this option."
        >
          {(control) => (
            <TextInput
              {...control}
              name={`${prefix}.label`}
              autocomplete="off"
              value={option.label}
              onInput={(event) => onChange({ ...option, label: event.currentTarget.value })}
            />
          )}
        </Field>
        <Field {...field(`${prefix}.capacity`)} label="Capacity" help="Leave empty for unlimited places.">
          {(control) => (
            <TextInput
              {...control}
              name={`${prefix}.capacity`}
              type="number"
              min="1"
              value={option.capacity ?? ""}
              onInput={(event) => onChange({ ...option, capacity: event.currentTarget.valueAsNumber || null })}
              placeholder="Unlimited"
            />
          )}
        </Field>
      </div>
      <div class="pk-cluster">
        <Button size="sm" variant="danger-quiet" onClick={onRemove}>
          Remove attendance option {ordinal}
        </Button>
      </div>
    </div>
  );
}

function DaysForm({
  groupId,
  event,
  response,
  expectedUpdatedAt,
  onRevision,
  reload,
  onSaved,
}: {
  groupId: string;
  event: GroupEvent;
  response: DaysResponse;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
  reload: () => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const timeInZone = useCallback(
    (iso: string | null): string => {
      if (!iso) return "";
      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) return "";
      return new Intl.DateTimeFormat("en-US", {
        timeZone: event.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(parsed);
    },
    [event.timezone],
  );
  const [days, setDays] = useState<DayState[]>(
    response.days.map((day) => ({
      id: day.id,
      date: day.date,
      label: day.label ?? "",
      startTime: timeInZone(day.startsAt),
      endTime: timeInZone(day.endsAt),
      sortOrder: day.sortOrder,
      attendanceOptions: day.attendanceOptions,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  function updateDay(index: number, patch: Partial<DayState>): void {
    setDays((current) => current.map((day, dayIndex) => (dayIndex === index ? { ...day, ...patch } : day)));
  }

  const form = useContractForm(groupEventDaysReplaceSchema, {
    expectedUpdatedAt,
    configuration: {
      days: days.map((day) => ({
        date: day.date,
        label: day.label || undefined,
        startTime: day.startTime || undefined,
        endTime: day.endTime || undefined,
        sortOrder: day.sortOrder,
        attendanceOptions: day.attendanceOptions,
      })),
    },
  });

  async function submit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const result = await putJson(path(groupId, event.id), checked.data, groupEventDaysReplaceResponseSchema);
      onRevision(result.eventUpdatedAt);
      if (result.skipped.length === 0) await onSaved();
      setStatus(
        result.skipped.length > 0 ? `Saved; retained dates in use: ${result.skipped.join(", ")}.` : "Days saved.",
      );
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" noValidate {...form.handlers} onSubmit={(event) => void submit(event)}>
      <ErrorAlert error={error} />
      {/* One disabled fieldset takes the whole form out of play while the save
          is in flight, rather than each control deciding for itself. */}
      <fieldset class="pk-fieldset pk-stack" disabled={saving}>
        {days.map((day, dayIndex) => (
          <Panel key={day.id ?? dayIndex}>
            <PanelHeader title={`Day ${String(dayIndex + 1)}`}>
              <Button
                size="sm"
                variant="danger-quiet"
                onClick={() => setDays((current) => current.filter((_, index) => index !== dayIndex))}
              >
                Remove day {dayIndex + 1}
              </Button>
            </PanelHeader>
            <PanelBody class="pk-stack">
              <div class="pk-grid pk-grid--tight">
                <Field {...form.of(`configuration.days.${dayIndex}.date`)} label="Date" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`configuration.days.${dayIndex}.date`}
                      type="date"
                      value={day.date}
                      onInput={(event) => updateDay(dayIndex, { date: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field
                  {...form.of(`configuration.days.${dayIndex}.startTime`)}
                  label="Starts at"
                  help={`Local time in ${event.timezone}.`}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`configuration.days.${dayIndex}.startTime`}
                      type="time"
                      step={60}
                      value={day.startTime}
                      onInput={(event) => updateDay(dayIndex, { startTime: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field
                  {...form.of(`configuration.days.${dayIndex}.endTime`)}
                  label="Ends at"
                  help={`Local time in ${event.timezone}.`}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`configuration.days.${dayIndex}.endTime`}
                      type="time"
                      step={60}
                      value={day.endTime}
                      onInput={(event) => updateDay(dayIndex, { endTime: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field
                  {...form.of(`configuration.days.${dayIndex}.sortOrder`)}
                  label="Sort order"
                  help="Lower numbers are listed first."
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`configuration.days.${dayIndex}.sortOrder`}
                      type="number"
                      min="0"
                      value={day.sortOrder}
                      onInput={(event) => updateDay(dayIndex, { sortOrder: event.currentTarget.valueAsNumber || 0 })}
                    />
                  )}
                </Field>
              </div>

              <Field
                {...form.of(`configuration.days.${dayIndex}.label`)}
                label="Label"
                help="Shown instead of the date, such as “Workshop day”."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name={`configuration.days.${dayIndex}.label`}
                    autocomplete="off"
                    value={day.label}
                    onInput={(event) => updateDay(dayIndex, { label: event.currentTarget.value })}
                  />
                )}
              </Field>

              <h4>Attendance options</h4>
              {day.attendanceOptions.map((option, optionIndex) => (
                <AttendanceOptionRow
                  key={optionIndex}
                  prefix={`configuration.days.${dayIndex}.attendanceOptions.${optionIndex}`}
                  field={form.of}
                  ordinal={optionIndex + 1}
                  option={option}
                  onChange={(next) =>
                    updateDay(dayIndex, {
                      attendanceOptions: day.attendanceOptions.map((current, index) =>
                        index === optionIndex ? next : current,
                      ),
                    })
                  }
                  onRemove={() =>
                    updateDay(dayIndex, {
                      attendanceOptions: day.attendanceOptions.filter((_, index) => index !== optionIndex),
                    })
                  }
                />
              ))}
              <div class="pk-cluster">
                <Button
                  size="sm"
                  onClick={() =>
                    updateDay(dayIndex, {
                      attendanceOptions: [...day.attendanceOptions, { value: "", label: "", capacity: null }],
                    })
                  }
                >
                  Add attendance option
                </Button>
              </div>
            </PanelBody>
          </Panel>
        ))}

        {days.length === 0 && (
          <EmptyState
            title="No attendance days configured"
            body="Registration will use one event-level attendance choice."
          />
        )}

        <div class="pk-cluster">
          <Button
            size="sm"
            onClick={() =>
              setDays((current) => [
                ...current,
                {
                  date: "",
                  label: "",
                  startTime: "",
                  endTime: "",
                  sortOrder: (current.length + 1) * 10,
                  attendanceOptions: [],
                },
              ])
            }
          >
            Add day
          </Button>
        </div>

        <div class="pk-cluster">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {saving ? "Saving days…" : "Save days"}
          </Button>
          <Button size="sm" onClick={() => void reload()}>
            Cancel
          </Button>
        </div>
      </fieldset>

      {status && <Alert tone="ok">{status}</Alert>}
    </form>
  );
}

export function EventDaysEditor({
  groupId,
  event,
  expectedUpdatedAt,
  onRevision,
}: {
  groupId: string;
  event: GroupEvent;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const resource = useData(() => getJson(path(groupId, event.id), groupEventDaysResponseSchema), [groupId, event.id]);
  if (resource.loading) return <Spinner label="Loading attendance days…" />;
  if (resource.error) return <ErrorAlert error={resource.error} />;
  if (!resource.data) return <></>;
  if (!editing)
    return (
      <div class="pk-stack">
        {saved && <Alert tone="ok">Days saved.</Alert>}
        <div class="pk-cluster pk-cluster--between">
          <p class="pk-small">Review the days and attendance choices available to registrants.</p>
          <Menu
            label="Attendance days actions"
            align="end"
            items={[
              {
                id: "edit",
                label: "Edit attendance days",
                onSelect: () => {
                  setSaved(false);
                  setEditing(true);
                },
              },
            ]}
          />
        </div>
        {resource.data.days.length ? (
          <DescriptionList
            items={resource.data.days.map((day) => ({
              term: day.label ? `${day.date} · ${day.label}` : day.date,
              value: day.attendanceOptions.map((option) => option.label).join(", ") || "No attendance options",
            }))}
          />
        ) : (
          <p class="pk-muted">No attendance days configured.</p>
        )}
      </div>
    );
  return (
    <DaysForm
      key={resource.data.eventUpdatedAt}
      groupId={groupId}
      event={event}
      response={resource.data}
      expectedUpdatedAt={expectedUpdatedAt}
      onRevision={onRevision}
      reload={async () => {
        setEditing(false);
        await resource.reload();
      }}
      onSaved={async () => {
        setSaved(true);
        setEditing(false);
        await resource.reload();
      }}
    />
  );
}
