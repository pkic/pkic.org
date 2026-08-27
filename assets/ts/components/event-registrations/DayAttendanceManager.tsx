import { useState } from "preact/hooks";
import type { EventDay } from "../../../shared/schemas/event-configuration";
import {
  eventRegistrationAdmitResponseSchema,
  eventRegistrationDayAttendanceResponseSchema,
  type EventRegistrationAttendanceDetailResponse,
} from "../../../shared/schemas/event-registration-detail";
import { patchJson, postJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import { DataTable } from "../Table";

type DayOption = "none" | string;
type AttendanceDetail = EventRegistrationAttendanceDetailResponse;

const WAITLIST_STATUS_COLOR: Readonly<Record<string, string>> = {
  waiting: "warning",
  offered: "info",
  accepted: "success",
  expired: "secondary",
  removed: "secondary",
};

export interface DayAttendanceManagerProps {
  dayAttendance: AttendanceDetail["dayAttendance"];
  dayWaitlist: AttendanceDetail["dayWaitlist"];
  eventDays: EventDay[];
  registrationEndpoint: string;
  idPrefix: string;
  onReload: () => void | Promise<void>;
  onSuccess?: (message: string) => void;
}

/**
 * Canonical per-day attendance, waitlist, and admission controls.
 * Authorization belongs to the selected route; this component owns only the
 * shared interaction and request contracts.
 */
export function DayAttendanceManager({
  dayAttendance,
  dayWaitlist,
  eventDays,
  registrationEndpoint,
  idPrefix,
  onReload,
  onSuccess,
}: DayAttendanceManagerProps) {
  const [pending, setPending] = useState<Record<string, DayOption>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [admitDayDates, setAdmitDayDates] = useState<string[]>([]);
  const [admitting, setAdmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "danger" } | null>(null);

  if (!eventDays.length) return <p class="small text-muted fst-italic mb-0">No event days configured.</p>;

  const attendanceByDate = new Map(dayAttendance.map((day) => [day.dayDate, day.attendanceType as DayOption]));
  const waitlistByDate = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry]));
  const rows = eventDays.map((day) => ({
    dayDate: day.date,
    label: day.label,
    inPersonCapacity: day.attendanceOptions.find((option) => option.value === "in_person")?.capacity ?? null,
    current: attendanceByDate.get(day.date) ?? ("none" as DayOption),
    options: day.attendanceOptions,
    waitlist: waitlistByDate.get(day.date) ?? null,
  }));
  const activeWaitlistCount = dayWaitlist.filter(
    (entry) => entry.status === "waiting" || entry.status === "offered",
  ).length;

  async function reloadWithSuccess(text: string): Promise<void> {
    onSuccess?.(text);
    await onReload();
    setMessage({ text, kind: "success" });
  }

  async function applyChange(dayDate: string, action: DayOption | "waitlist"): Promise<void> {
    setSaving((current) => ({ ...current, [dayDate]: true }));
    setMessage(null);
    try {
      await patchJson(
        `${registrationEndpoint}/day-attendance`,
        { action: action === "none" ? "remove" : action, dayDates: [dayDate] },
        eventRegistrationDayAttendanceResponseSchema,
      );
      setPending((current) => {
        const next = { ...current };
        delete next[dayDate];
        return next;
      });
      await reloadWithSuccess(`Day ${dayDate} updated.`);
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: "danger" });
    } finally {
      setSaving((current) => ({ ...current, [dayDate]: false }));
    }
  }

  function setAdmitChecked(dayDate: string, checked: boolean): void {
    setAdmitDayDates((current) => {
      const next = new Set(current);
      if (checked) next.add(dayDate);
      else next.delete(dayDate);
      return Array.from(next);
    });
  }

  async function admitSelectedDays(): Promise<void> {
    if (admitDayDates.length === 0) return;
    setAdmitting(true);
    setMessage(null);
    try {
      await postJson(
        `${registrationEndpoint}/admit`,
        {
          mode: "capacity_exempt",
          reason: "Event manager approved in-person admission",
          dayDates: admitDayDates,
        },
        eventRegistrationAdmitResponseSchema,
      );
      const admittedCount = admitDayDates.length;
      setAdmitDayDates([]);
      await reloadWithSuccess(
        `${admittedCount === 1 ? "Day" : "Days"} admitted; the registration update email was queued.`,
      );
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: "danger" });
    } finally {
      setAdmitting(false);
    }
  }

  return (
    <>
      {activeWaitlistCount > 0 && (
        <div class="alert alert-info small py-2 mb-3">
          Select <strong>Manager override</strong> for one or more waitlisted in-person days to admit this attendee
          beyond capacity. Admission removes those day waitlist entries and queues an update email.
        </div>
      )}
      {message && (
        <div class={`alert alert-${message.kind} small py-2`} role="status" aria-live="polite">
          {message.text}
        </div>
      )}
      <DataTable
        columns={[
          { header: "Date", cell: (day) => day.dayDate, className: "mono small" },
          { header: "Day", cell: (day) => day.label ?? "—", className: "small" },
          {
            header: "Attendance",
            cell: (day) => {
              const selected = pending[day.dayDate] ?? day.current;
              const isSaving = saving[day.dayDate] ?? false;
              const changed = selected !== day.current;
              return (
                <div class="d-flex gap-1 align-items-center">
                  <select
                    class="form-select form-select-sm"
                    aria-label={`Attendance for ${day.dayDate}`}
                    value={selected}
                    disabled={isSaving}
                    onChange={(event) => {
                      const value = (event.target as HTMLSelectElement).value as DayOption;
                      setPending((current) => ({ ...current, [day.dayDate]: value }));
                      if (value !== "in_person") setAdmitChecked(day.dayDate, false);
                    }}
                  >
                    {[
                      { value: "none", label: "Not attending" },
                      ...day.options,
                      ...(selected !== "none" && !day.options.some((option) => option.value === selected)
                        ? [{ value: selected, label: selected.replaceAll("_", " ") }]
                        : []),
                    ].map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {changed && (
                    <button
                      type="button"
                      class="btn btn-sm btn-primary text-nowrap"
                      disabled={isSaving}
                      onClick={() => void applyChange(day.dayDate, selected)}
                    >
                      {isSaving ? "Saving…" : "Apply"}
                    </button>
                  )}
                </div>
              );
            },
          },
          {
            header: "Waitlist",
            cell: (day) =>
              day.waitlist ? (
                <div class="small">
                  <span class={`badge text-bg-${WAITLIST_STATUS_COLOR[day.waitlist.status] ?? "secondary"} me-2`}>
                    {day.waitlist.status}
                  </span>
                  <span class="text-muted">{day.waitlist.priorityLane}</span>
                  {day.waitlist.offerExpiresAt && (
                    <div class="text-muted mono mt-1">Offer expires {formatDateTime(day.waitlist.offerExpiresAt)}</div>
                  )}
                </div>
              ) : (
                <span class="small text-muted">—</span>
              ),
          },
          {
            header: "Manager override",
            cell: (day) => {
              const selected = pending[day.dayDate] ?? day.current;
              const activeWaitlist = day.waitlist?.status === "waiting" || day.waitlist?.status === "offered";
              const canAdmit = activeWaitlist && selected === "in_person";
              const canReturnToWaitlist =
                !activeWaitlist &&
                selected === "in_person" &&
                day.current === "in_person" &&
                day.inPersonCapacity != null &&
                day.inPersonCapacity > 0;
              const inputId = `${idPrefix}-admit-${day.dayDate}`;
              return (
                <div>
                  <div class="form-check mb-1">
                    <input
                      id={inputId}
                      type="checkbox"
                      class="form-check-input"
                      checked={admitDayDates.includes(day.dayDate)}
                      disabled={!canAdmit || admitting}
                      onChange={(event) => setAdmitChecked(day.dayDate, (event.target as HTMLInputElement).checked)}
                    />
                    <label class={`form-check-label small ${canAdmit ? "" : "text-muted"}`} for={inputId}>
                      Admit day
                    </label>
                  </div>
                  {canReturnToWaitlist && (
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-warning text-nowrap"
                      disabled={saving[day.dayDate] ?? false}
                      onClick={() => void applyChange(day.dayDate, "waitlist")}
                    >
                      Return to waitlist
                    </button>
                  )}
                </div>
              );
            },
            className: "text-nowrap",
          },
        ]}
        data={rows}
        className="align-middle"
        rowKey={(day) => day.dayDate}
      />
      <div class="d-flex align-items-center gap-2 mt-3 flex-wrap">
        <button
          type="button"
          class="btn btn-sm btn-warning"
          disabled={admitDayDates.length === 0 || admitting}
          onClick={() => void admitSelectedDays()}
        >
          {admitting ? "Admitting…" : "Admit selected days"}
        </button>
        <span class="small text-muted">
          {admitDayDates.length > 0
            ? `${admitDayDates.length} ${admitDayDates.length === 1 ? "day" : "days"} selected`
            : "Select waitlisted in-person days to enable admission."}
        </span>
      </div>
    </>
  );
}
