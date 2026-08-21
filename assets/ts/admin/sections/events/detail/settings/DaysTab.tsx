import { useCallback, useState } from "preact/hooks";
import { api } from "../../../../api";
import type { AdminAttendanceOption, AdminEventDay } from "../../../../types";
import { useAdminEditorResource } from "../../../../hooks/useAdminEditorResource";
import { saveAdminEditor } from "../../../../actions";
import { AdminSettingsEditor } from "../../../../components/AdminSettingsEditor";

function DayOptionRow({
  option,
  onChange,
  onRemove,
}: {
  option: AdminAttendanceOption;
  onChange: (option: AdminAttendanceOption) => void;
  onRemove: () => void;
}) {
  return (
    <div class="d-flex gap-2 align-items-center mb-1">
      <input
        class="form-control form-control-sm"
        type="text"
        placeholder="value (e.g. in_person)"
        value={option.value}
        onInput={(event) => onChange({ ...option, value: (event.target as HTMLInputElement).value })}
      />
      <input
        class="form-control form-control-sm"
        type="text"
        placeholder="Label"
        value={option.label}
        onInput={(event) => onChange({ ...option, label: (event.target as HTMLInputElement).value })}
      />
      <input
        class="form-control form-control-sm"
        type="number"
        placeholder="Capacity"
        value={option.capacity ?? ""}
        onInput={(event) =>
          onChange({
            ...option,
            capacity: (event.target as HTMLInputElement).value
              ? parseInt((event.target as HTMLInputElement).value, 10)
              : null,
          })
        }
      />
      <button type="button" class="btn btn-sm btn-outline-danger" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

interface DayState {
  id?: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  attendanceOptions: AdminAttendanceOption[];
}

export function DaysTab({ slug, timezone }: { slug: string; timezone: string }) {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const timeInZone = useCallback(
    (iso: string | null | undefined): string => {
      if (!iso || !timezone) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date);
    },
    [timezone],
  );

  const daysResource = useAdminEditorResource<DayState[]>(
    async () => {
      const data = await api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`);
      return (data.days ?? []).map((day) => ({
        id: day.id,
        date: day.date,
        label: day.label ?? "",
        startTime: timeInZone(day.startsAt),
        endTime: timeInZone(day.endsAt),
        sortOrder: day.sortOrder,
        attendanceOptions: day.attendanceOptions ?? [],
      }));
    },
    [slug, timeInZone],
    [],
  );
  const { value: days, setValue: setDays, loading, error, reload } = daysResource;

  function updateDay(index: number, patch: Partial<DayState>) {
    setDays((current) => current.map((day, dayIndex) => (dayIndex === index ? { ...day, ...patch } : day)));
  }

  function addOption(dayIndex: number) {
    updateDay(dayIndex, {
      attendanceOptions: [...days[dayIndex].attendanceOptions, { value: "", label: "", capacity: null }],
    });
  }

  async function handleSave() {
    const body = days
      .filter((day) => day.date.trim())
      .map((day) => ({
        date: day.date.trim(),
        label: day.label.trim() || undefined,
        startTime: day.startTime.trim() || undefined,
        endTime: day.endTime.trim() || undefined,
        sortOrder: day.sortOrder,
        attendanceOptions: day.attendanceOptions.filter((option) => option.value && option.label),
      }));
    await saveAdminEditor({
      setSaving,
      setStatus: setSaveStatus,
      request: () =>
        api<{ skipped?: string[] }>(`/api/v1/admin/events/${slug}/days`, {
          method: "PUT",
          body: JSON.stringify({ days: body }),
        }),
      successMessage: "Event days updated",
      successStatus: (response) => {
        const skipped = response.skipped ?? [];
        return skipped.length ? `Saved with warnings. Could not remove: ${skipped.join(", ")}` : "✓ Saved";
      },
      reload,
    });
  }

  return (
    <AdminSettingsEditor
      loading={loading}
      error={error}
      description="Manage per-day attendance options and local event times"
      actions={
        <>
          <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
            ↺ Refresh
          </button>
          <button
            class="btn btn-sm btn-success"
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
            + Add day
          </button>
          <button class="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save Days
          </button>
        </>
      }
    >
      {saveStatus && (
        <div class={`small mb-2 ${saveStatus.startsWith("✓") ? "text-success" : "text-warning"}`}>{saveStatus}</div>
      )}

      {days.map((day, dayIndex) => (
        <div key={day.id ?? dayIndex} class="card border mb-3">
          <div class="card-body">
            <div class="row g-2 mb-2">
              <div class="col-md-3">
                <label class="form-label small mb-1">Date</label>
                <input
                  class="form-control form-control-sm"
                  type="date"
                  value={day.date}
                  onInput={(event) => updateDay(dayIndex, { date: (event.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Starts at</label>
                <input
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.startTime}
                  onInput={(event) => updateDay(dayIndex, { startTime: (event.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Ends at</label>
                <input
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.endTime}
                  onInput={(event) => updateDay(dayIndex, { endTime: (event.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Sort</label>
                <input
                  class="form-control form-control-sm"
                  type="number"
                  value={day.sortOrder}
                  onInput={(event) =>
                    updateDay(dayIndex, { sortOrder: parseInt((event.target as HTMLInputElement).value, 10) || 0 })
                  }
                />
              </div>
            </div>
            <div class="row g-2 mb-2">
              <div class="col-md-10">
                <label class="form-label small mb-1">Label</label>
                <input
                  class="form-control form-control-sm"
                  value={day.label}
                  onInput={(event) => updateDay(dayIndex, { label: (event.target as HTMLInputElement).value })}
                  placeholder="Thursday, December 3, 2026"
                />
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger w-100"
                  onClick={() => setDays((current) => current.filter((_, index) => index !== dayIndex))}
                >
                  Remove
                </button>
              </div>
            </div>
            <div class="small fw-semibold mb-1">Attendance options</div>
            {day.attendanceOptions.map((option, optionIndex) => (
              <DayOptionRow
                key={`${option.value}-${optionIndex}`}
                option={option}
                onChange={(nextOption) =>
                  updateDay(dayIndex, {
                    attendanceOptions: day.attendanceOptions.map((current, index) =>
                      index === optionIndex ? nextOption : current,
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
            <button type="button" class="btn btn-sm btn-outline-secondary mt-1" onClick={() => addOption(dayIndex)}>
              + Option
            </button>
          </div>
        </div>
      ))}

      {days.length === 0 && <p class="text-muted fst-italic small">No days configured yet.</p>}
    </AdminSettingsEditor>
  );
}
