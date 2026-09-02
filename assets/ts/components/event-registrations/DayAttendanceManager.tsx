import { useState } from "preact/hooks";
import type { EventDay } from "../../../shared/schemas/event-configuration";
import {
  eventRegistrationAdmitResponseSchema,
  eventRegistrationDayAttendanceResponseSchema,
  eventRegistrationSelectedDayAdmitSchema,
  type EventRegistrationAttendanceDetailResponse,
} from "../../../shared/schemas/event-registration-detail";
import { useContractForm } from "../../hooks/useContractForm";
import { patchJson, postJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import { DataTable } from "../Table";
import { Badge } from "../Badge";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, Textarea } from "../../ui/TextControl";

// `pk-mono` on the offer-expiry stamp comes from the content stylesheet,
// which is not in the entry chunk, so this module has to pull it in.
import "../../ui/Content.css";

type DayOption = "none" | string;
type AttendanceDetail = EventRegistrationAttendanceDetailResponse;

export interface DayAttendanceManagerProps {
  dayAttendance: AttendanceDetail["dayAttendance"];
  dayWaitlist: AttendanceDetail["dayWaitlist"];
  eventDays: EventDay[];
  registrationEndpoint: string;
  /** Server-derived effective event manage capability; never infer this in the component. */
  canVip?: boolean;
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
  canVip = false,
  onReload,
  onSuccess,
}: DayAttendanceManagerProps) {
  const [pending, setPending] = useState<Record<string, DayOption>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [admitDayDates, setAdmitDayDates] = useState<string[]>([]);
  const [admitting, setAdmitting] = useState(false);
  const [vipDayDates, setVipDayDates] = useState<string[]>([]);
  const [vipReason, setVipReason] = useState("");
  const [applyingVip, setApplyingVip] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "danger" } | null>(null);
  // One basis for validation: the shared admission contract the server parses
  // decides what the reason field shows, live, and what the override may send.
  const vipForm = useContractForm(eventRegistrationSelectedDayAdmitSchema, {
    mode: "vip",
    reason: vipReason,
    dayDates: vipDayDates,
  });

  if (!eventDays.length) return <p class="pk pk-small">No event days configured.</p>;

  const attendanceByDate = new Map(dayAttendance.map((day) => [day.dayDate, day.attendanceType as DayOption]));
  const waitlistByDate = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry]));
  const rows = eventDays.map((day) => {
    const inPerson = day.attendanceOptions.find((option) => option.value === "in_person");
    return {
      dayDate: day.date,
      label: day.label,
      supportsInPerson: Boolean(inPerson),
      inPersonCapacity: inPerson?.capacity ?? null,
      current: attendanceByDate.get(day.date) ?? ("none" as DayOption),
      options: day.attendanceOptions,
      waitlist: waitlistByDate.get(day.date) ?? null,
    };
  });
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

  function setVipChecked(dayDate: string, checked: boolean): void {
    setVipDayDates((current) => {
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
        `${registrationEndpoint}/admissions`,
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

  async function applyVipOverride(): Promise<void> {
    const checked = vipForm.submit();
    if (!checked.data) return;
    setApplyingVip(true);
    setMessage(null);
    try {
      await postJson(`${registrationEndpoint}/admissions`, checked.data, eventRegistrationAdmitResponseSchema);
      const admittedCount = checked.data.dayDates.length;
      setVipDayDates([]);
      setVipReason("");
      vipForm.reset();
      await reloadWithSuccess(
        `VIP override applied to ${admittedCount} ${admittedCount === 1 ? "day" : "days"}; the registration update email was queued.`,
      );
    } catch (error) {
      setMessage({ text: vipForm.refuse(error), kind: "danger" });
    } finally {
      setApplyingVip(false);
    }
  }

  return (
    <div class="pk pk-stack pk-stack--snug">
      {activeWaitlistCount > 0 && (
        <Alert tone="info">
          Select <strong>Manager override</strong> for one or more waitlisted in-person days to admit this attendee
          beyond capacity. Admission removes those day waitlist entries and queues an update email.
        </Alert>
      )}
      {/*
       * Outcome messages name what happened, so the tone reinforces the words
       * rather than carrying the meaning on its own. Alert also picks the
       * right live-region role per tone: a failure interrupts, a success does
       * not.
       */}
      {message && <Alert tone={message.kind === "success" ? "ok" : "danger"}>{message.text}</Alert>}
      <DataTable
        caption="Attendance by event day"
        columns={[
          { header: "Date", cell: (day) => day.dayDate, className: "pk-mono pk-small" },
          { header: "Day", cell: (day) => day.label ?? "—", className: "pk-small" },
          {
            header: "Attendance",
            cell: (day) => {
              const selected = pending[day.dayDate] ?? day.current;
              const isSaving = saving[day.dayDate] ?? false;
              const changed = selected !== day.current;
              return (
                <div class="pk-cluster">
                  <Select
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
                  </Select>
                  {changed && (
                    <Button
                      size="sm"
                      variant="primary"
                      class="pk-nowrap"
                      loading={isSaving}
                      onClick={() => void applyChange(day.dayDate, selected)}
                    >
                      {isSaving ? "Saving…" : "Apply"}
                    </Button>
                  )}
                </div>
              );
            },
          },
          {
            header: "Waitlist",
            cell: (day) =>
              day.waitlist ? (
                <div class="pk-stack pk-stack--tight pk-small">
                  <div class="pk-cluster">
                    <Badge status={day.waitlist.status} />
                    <span class="pk-muted">{day.waitlist.priorityLane}</span>
                  </div>
                  {day.waitlist.offerExpiresAt && (
                    <span class="pk-muted pk-mono">Offer expires {formatDateTime(day.waitlist.offerExpiresAt)}</span>
                  )}
                </div>
              ) : (
                <span class="pk-small">—</span>
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
              return (
                <div class="pk-stack pk-stack--tight">
                  <Checkbox
                    class="pk-small"
                    checked={admitDayDates.includes(day.dayDate)}
                    disabled={!canAdmit || admitting}
                    onChange={(event) => setAdmitChecked(day.dayDate, (event.target as HTMLInputElement).checked)}
                    label="Admit day"
                  />
                  {canReturnToWaitlist && (
                    <div class="pk-cluster">
                      <Button
                        size="sm"
                        variant="danger-quiet"
                        class="pk-nowrap"
                        disabled={saving[day.dayDate] ?? false}
                        onClick={() => void applyChange(day.dayDate, "waitlist")}
                      >
                        Return to waitlist
                      </Button>
                    </div>
                  )}
                </div>
              );
            },
            className: "pk-nowrap",
          },
        ]}
        data={rows}
        rowKey={(day) => day.dayDate}
      />
      <div class="pk-cluster">
        <Button
          size="sm"
          variant="primary"
          disabled={admitDayDates.length === 0}
          loading={admitting}
          onClick={() => void admitSelectedDays()}
        >
          {admitting ? "Admitting…" : "Admit selected days"}
        </Button>
        <span class="pk-small" role="status">
          {admitDayDates.length > 0
            ? `${admitDayDates.length} ${admitDayDates.length === 1 ? "day" : "days"} selected`
            : "Select waitlisted in-person days to enable admission."}
        </span>
      </div>
      {/* The override is one of several sections stacked inside the attendance
          panel, so it names itself: an unnamed <section> is announced as
          nothing at all. */}
      {canVip && (
        <Panel aria-label="Reasoned VIP admission override">
          <PanelHeader title="Reasoned VIP admission override" />
          <PanelBody class="pk-stack pk-stack--snug">
            <p class="pk-small">
              Requires the effective event <code>manage</code> capability. The narrower <code>manage_attendance</code>
              capability can admit only actively waitlisted days and cannot use this capacity override.
            </p>
            {/* The contract's handlers sit on the group so every control in it
                reports being touched; the reason is the one they name. */}
            <div class="pk-stack pk-stack--snug" {...vipForm.handlers}>
              <fieldset class="pk-fieldset pk-field" disabled={applyingVip}>
                <legend class="pk-field__label">Days to admit</legend>
                <div class="pk-cluster">
                  {rows
                    .filter((day) => day.supportsInPerson)
                    .map((day) => (
                      <Checkbox
                        key={day.dayDate}
                        checked={vipDayDates.includes(day.dayDate)}
                        disabled={applyingVip}
                        onChange={(event) => setVipChecked(day.dayDate, (event.target as HTMLInputElement).checked)}
                        label={`${day.label ? `${day.label} — ` : ""}${day.dayDate}`}
                      />
                    ))}
                </div>
              </fieldset>
              <Field
                label="Required reason"
                required
                help="At least three characters. This action is audited and queues a registration-update email."
                {...vipForm.of("reason")}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="reason"
                    rows={2}
                    minLength={3}
                    maxLength={1000}
                    value={vipReason}
                    disabled={applyingVip}
                    onInput={(event) => setVipReason((event.target as HTMLTextAreaElement).value)}
                  />
                )}
              </Field>
              <div class="pk-cluster">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!vipForm.valid}
                  loading={applyingVip}
                  onClick={() => void applyVipOverride()}
                >
                  {applyingVip ? "Applying…" : "Apply VIP override"}
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
