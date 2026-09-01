import { useCallback, useState } from "preact/hooks";
import type { z } from "zod";
import type { EventAttendanceOption } from "../../../../../shared/schemas/event-configuration";
import {
  groupEventDaysReplaceResponseSchema,
  groupEventDaysResponseSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
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
  option,
  onChange,
  onRemove,
}: {
  ordinal: number;
  option: EventAttendanceOption;
  onChange: (option: EventAttendanceOption) => void;
  onRemove: () => void;
}) {
  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-grid pk-grid--tight">
        <Field label="Value" required help="Lowercase key stored with the registration, such as in_person.">
          {(control) => (
            <TextInput
              {...control}
              class="pk-mono"
              autocomplete="off"
              value={option.value}
              onInput={(event) => onChange({ ...option, value: event.currentTarget.value })}
              placeholder="in_person"
            />
          )}
        </Field>
        <Field label="Label" required help="What an attendee sees when choosing this option.">
          {(control) => (
            <TextInput
              {...control}
              autocomplete="off"
              value={option.label}
              onInput={(event) => onChange({ ...option, label: event.currentTarget.value })}
            />
          )}
        </Field>
        <Field label="Capacity" help="Leave empty for unlimited places.">
          {(control) => (
            <TextInput
              {...control}
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
}: {
  groupId: string;
  event: GroupEvent;
  response: DaysResponse;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
  reload: () => Promise<void>;
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

  async function submit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const result = await putJson(
        path(groupId, event.id),
        {
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
        },
        groupEventDaysReplaceResponseSchema,
      );
      onRevision(result.eventUpdatedAt);
      setStatus(
        result.skipped.length > 0 ? `Saved; retained dates in use: ${result.skipped.join(", ")}.` : "Days saved.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save event days.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" onSubmit={(event) => void submit(event)}>
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
                <Field label="Date" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="date"
                      value={day.date}
                      onInput={(event) => updateDay(dayIndex, { date: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Starts at" help={`Local time in ${event.timezone}.`}>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="time"
                      step={60}
                      value={day.startTime}
                      onInput={(event) => updateDay(dayIndex, { startTime: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Ends at" help={`Local time in ${event.timezone}.`}>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="time"
                      step={60}
                      value={day.endTime}
                      onInput={(event) => updateDay(dayIndex, { endTime: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Sort order" help="Lower numbers are listed first.">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      min="0"
                      value={day.sortOrder}
                      onInput={(event) => updateDay(dayIndex, { sortOrder: event.currentTarget.valueAsNumber || 0 })}
                    />
                  )}
                </Field>
              </div>

              <Field label="Label" help="Shown instead of the date, such as “Workshop day”.">
                {(control) => (
                  <TextInput
                    {...control}
                    autocomplete="off"
                    value={day.label}
                    onInput={(event) => updateDay(dayIndex, { label: event.currentTarget.value })}
                  />
                )}
              </Field>

              <h4>Attendance options</h4>
              {day.attendanceOptions.map((option, optionIndex) => (
                <AttendanceOptionRow
                  key={`${option.value}-${optionIndex}`}
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
  const resource = useData(() => getJson(path(groupId, event.id), groupEventDaysResponseSchema), [groupId, event.id]);
  if (resource.loading) return <Spinner label="Loading attendance days…" />;
  if (resource.error) return <ErrorAlert error={resource.error} />;
  if (!resource.data) return <></>;
  return (
    <DaysForm
      key={resource.data.eventUpdatedAt}
      groupId={groupId}
      event={event}
      response={resource.data}
      expectedUpdatedAt={expectedUpdatedAt}
      onRevision={onRevision}
      reload={resource.reload}
    />
  );
}
