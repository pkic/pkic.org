import { useState } from "preact/hooks";
import { DataTable } from "../../../../../components/Table";
import { api, apiCommand } from "../../../../api";
import { fmt, toast } from "../../../../ui";
import type { AdminEventDay } from "../../../../types";
import type { AttendanceType } from "../../../../../../shared/schemas/registration";
import { adminRegistrationAdmitResponseSchema } from "../../../../../../shared/schemas/route-contracts-admin-registrations";

type DayOption = "none" | AttendanceType;

const DAY_OPTIONS: { value: DayOption; label: string }[] = [
  { value: "none", label: "Not attending" },
  { value: "in_person", label: "In-person" },
  { value: "virtual", label: "Virtual" },
  { value: "on_demand", label: "On-demand" },
];

export function DayAttendancePanel({
  dayAttendance,
  dayWaitlist,
  eventDays,
  slug,
  regId,
  onReload,
}: {
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
  eventDays: AdminEventDay[];
  slug: string;
  regId: string;
  onReload: () => void;
}) {
  const [pending, setPending] = useState<Record<string, DayOption>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [admitDayDates, setAdmitDayDates] = useState<string[]>([]);
  const [admitting, setAdmitting] = useState(false);

  if (!eventDays.length) return <p class="small text-muted fst-italic mb-0">No event days configured.</p>;

  const attendanceByDate = new Map(dayAttendance.map((d) => [d.dayDate, d.attendanceType as DayOption]));
  const waitlistByDate = new Map(dayWaitlist.map((w) => [w.dayDate, w]));
  const rows = eventDays.map((d) => ({
    dayDate: d.date,
    label: d.label,
    inPersonCapacity: d.attendanceOptions.find((option) => option.value === "in_person")?.capacity ?? null,
    current: attendanceByDate.get(d.date) ?? ("none" as DayOption),
    waitlist: waitlistByDate.get(d.date) ?? null,
  }));
  const activeWaitlistCount = dayWaitlist.filter((w) => w.status === "waiting" || w.status === "offered").length;
  const statusColour: Record<string, string> = {
    waiting: "warning",
    offered: "info",
    accepted: "success",
    expired: "secondary",
    removed: "secondary",
  };

  async function applyChange(dayDate: string, action: DayOption | "waitlist") {
    setSaving((s) => ({ ...s, [dayDate]: true }));
    try {
      await apiCommand(`/api/v1/admin/events/${slug}/registrations/${regId}/day-attendance`, {
        method: "PATCH",
        body: JSON.stringify({ action: action === "none" ? "remove" : action, dayDates: [dayDate] }),
      });
      toast(`Day ${dayDate} updated`, "success");
      setPending((p) => {
        const n = { ...p };
        delete n[dayDate];
        return n;
      });
      onReload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving((s) => ({ ...s, [dayDate]: false }));
    }
  }

  function setAdmitChecked(dayDate: string, checked: boolean) {
    setAdmitDayDates((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(dayDate);
      } else {
        next.delete(dayDate);
      }
      return Array.from(next);
    });
  }

  async function admitSelectedDays() {
    if (admitDayDates.length === 0) return;
    setAdmitting(true);
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}/admit`, adminRegistrationAdmitResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          mode: "capacity_exempt",
          reason: "Admin approved in-person admission",
          dayDates: admitDayDates,
        }),
      });
      toast(`${admitDayDates.length === 1 ? "Day" : "Days"} admitted; registration update email queued`, "success");
      setAdmitDayDates([]);
      onReload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAdmitting(false);
    }
  }

  return (
    <>
      {activeWaitlistCount > 0 && (
        <div class="alert alert-info small py-2 mb-3">
          Select <strong>Admin override</strong> for one or more waitlisted in-person days to admit the attendee beyond
          capacity. This removes those day waitlist entries, updates the registration as needed, and sends an update
          email confirming their in-person acceptance.
        </div>
      )}
      <DataTable
        columns={[
          { header: "Date", cell: (d) => d.dayDate, className: "mono small" },
          { header: "Day", cell: (d) => d.label ?? "—", className: "small" },
          {
            header: "Attendance",
            cell: (d) => {
              const selected = pending[d.dayDate] ?? d.current;
              const isSaving = saving[d.dayDate] ?? false;
              const changed = selected !== d.current;
              return (
                <div class="d-flex gap-1 align-items-center">
                  <select
                    class="form-select form-select-sm adm-filter-select"
                    value={selected}
                    disabled={isSaving}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value as DayOption;
                      setPending((p) => ({ ...p, [d.dayDate]: v }));
                      if (v !== "in_person") {
                        setAdmitChecked(d.dayDate, false);
                      }
                    }}
                  >
                    {DAY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {changed && (
                    <button
                      class="btn btn-sm btn-primary text-nowrap"
                      disabled={isSaving}
                      onClick={() => void applyChange(d.dayDate, selected)}
                    >
                      {isSaving ? "…" : "Apply"}
                    </button>
                  )}
                </div>
              );
            },
          },
          {
            header: "Waitlist",
            cell: (d) =>
              d.waitlist ? (
                <div class="small">
                  <span class={`badge text-bg-${statusColour[d.waitlist.status] ?? "secondary"} me-2`}>
                    {d.waitlist.status}
                  </span>
                  <span class="text-muted">{d.waitlist.priorityLane}</span>
                  {d.waitlist.offerExpiresAt && (
                    <div class="text-muted mono mt-1">Offer expires {fmt(d.waitlist.offerExpiresAt)}</div>
                  )}
                </div>
              ) : (
                <span class="small text-muted">—</span>
              ),
          },
          {
            header: "Admin override",
            cell: (d) => {
              const selected = pending[d.dayDate] ?? d.current;
              const activeWaitlist = d.waitlist?.status === "waiting" || d.waitlist?.status === "offered";
              const canAdmit = activeWaitlist && selected === "in_person";
              const canReturnToWaitlist =
                !activeWaitlist &&
                selected === "in_person" &&
                d.current === "in_person" &&
                d.inPersonCapacity != null &&
                d.inPersonCapacity > 0;
              const inputId = `admin-admit-${d.dayDate}`;
              return (
                <div>
                  <div class="form-check mb-1">
                    <input
                      id={inputId}
                      type="checkbox"
                      class="form-check-input"
                      checked={admitDayDates.includes(d.dayDate)}
                      disabled={!canAdmit || admitting}
                      onChange={(e) => setAdmitChecked(d.dayDate, (e.target as HTMLInputElement).checked)}
                    />
                    <label class={`form-check-label small ${canAdmit ? "" : "text-muted"}`} for={inputId}>
                      Admit day
                    </label>
                  </div>
                  {canReturnToWaitlist && (
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-warning text-nowrap"
                      disabled={saving[d.dayDate] ?? false}
                      onClick={() => void applyChange(d.dayDate, "waitlist")}
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
        rowKey={(d) => d.dayDate}
      />
      <div class="d-flex align-items-center gap-2 mt-3 flex-wrap">
        <button
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
