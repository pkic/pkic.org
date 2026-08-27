import { useCallback, useState } from "preact/hooks";
import type { z } from "zod";
import type { EventAttendanceOption } from "../../../../../shared/schemas/event-configuration";
import {
  groupEventDaysReplaceResponseSchema,
  groupEventDaysResponseSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";

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

function AttendanceOptionRow({
  idPrefix,
  option,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  option: EventAttendanceOption;
  onChange: (option: EventAttendanceOption) => void;
  onRemove: () => void;
}) {
  return (
    <div class="row g-2 align-items-end mb-2">
      <div class="col-md-4">
        <label class="form-label small mb-1" for={`${idPrefix}-value`}>
          Value
        </label>
        <input
          id={`${idPrefix}-value`}
          class="form-control form-control-sm"
          autocomplete="off"
          value={option.value}
          onInput={(event) => onChange({ ...option, value: event.currentTarget.value })}
          placeholder="in_person"
          required
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small mb-1" for={`${idPrefix}-label`}>
          Label
        </label>
        <input
          id={`${idPrefix}-label`}
          class="form-control form-control-sm"
          autocomplete="off"
          value={option.label}
          onInput={(event) => onChange({ ...option, label: event.currentTarget.value })}
          required
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small mb-1" for={`${idPrefix}-capacity`}>
          Capacity
        </label>
        <input
          id={`${idPrefix}-capacity`}
          class="form-control form-control-sm"
          type="number"
          min="1"
          value={option.capacity ?? ""}
          onInput={(event) => onChange({ ...option, capacity: event.currentTarget.valueAsNumber || null })}
          placeholder="Unlimited"
        />
      </div>
      <div class="col-md-1">
        <button
          type="button"
          class="btn btn-sm btn-outline-danger"
          onClick={onRemove}
          aria-label="Remove attendance option"
        >
          Remove
        </button>
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
    <form onSubmit={(event) => void submit(event)}>
      <ErrorAlert error={error} />
      {days.map((day, dayIndex) => (
        <div key={day.id ?? dayIndex} class="card border mb-3">
          <div class="card-body">
            <div class="row g-2 mb-2">
              <div class="col-md-3">
                <label class="form-label small mb-1" for={`${event.id}-day-${dayIndex}-date`}>
                  Date
                </label>
                <input
                  id={`${event.id}-day-${dayIndex}-date`}
                  class="form-control form-control-sm"
                  type="date"
                  value={day.date}
                  onInput={(event) => updateDay(dayIndex, { date: event.currentTarget.value })}
                  required
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1" for={`${event.id}-day-${dayIndex}-starts-at`}>
                  Starts at
                </label>
                <input
                  id={`${event.id}-day-${dayIndex}-starts-at`}
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.startTime}
                  onInput={(event) => updateDay(dayIndex, { startTime: event.currentTarget.value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1" for={`${event.id}-day-${dayIndex}-ends-at`}>
                  Ends at
                </label>
                <input
                  id={`${event.id}-day-${dayIndex}-ends-at`}
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.endTime}
                  onInput={(event) => updateDay(dayIndex, { endTime: event.currentTarget.value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1" for={`${event.id}-day-${dayIndex}-sort-order`}>
                  Sort order
                </label>
                <input
                  id={`${event.id}-day-${dayIndex}-sort-order`}
                  class="form-control form-control-sm"
                  type="number"
                  min="0"
                  value={day.sortOrder}
                  onInput={(event) => updateDay(dayIndex, { sortOrder: event.currentTarget.valueAsNumber || 0 })}
                />
              </div>
            </div>
            <div class="row g-2 mb-2">
              <div class="col-md-10">
                <label class="form-label small mb-1" for={`${event.id}-day-${dayIndex}-label`}>
                  Label
                </label>
                <input
                  id={`${event.id}-day-${dayIndex}-label`}
                  class="form-control form-control-sm"
                  autocomplete="off"
                  value={day.label}
                  onInput={(event) => updateDay(dayIndex, { label: event.currentTarget.value })}
                />
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger w-100"
                  onClick={() => setDays((current) => current.filter((_, index) => index !== dayIndex))}
                >
                  Remove day
                </button>
              </div>
            </div>
            <h6 class="small fw-semibold">Attendance options</h6>
            {day.attendanceOptions.map((option, optionIndex) => (
              <AttendanceOptionRow
                key={`${option.value}-${optionIndex}`}
                idPrefix={`${event.id}-day-${dayIndex}-option-${optionIndex}`}
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
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              onClick={() =>
                updateDay(dayIndex, {
                  attendanceOptions: [...day.attendanceOptions, { value: "", label: "", capacity: null }],
                })
              }
            >
              Add attendance option
            </button>
          </div>
        </div>
      ))}
      {days.length === 0 && (
        <p class="small text-muted">
          No attendance days configured. Registration will use one event-level attendance choice.
        </p>
      )}
      <div class="d-flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
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
        </button>
      </div>
      <FormActions
        submitLabel="Save days"
        busyLabel="Saving days…"
        busy={saving}
        onCancel={() => void reload()}
        status={status}
        submitVariant="primary"
      />
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
  if (resource.loading) return <p class="small text-muted">Loading attendance days…</p>;
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
