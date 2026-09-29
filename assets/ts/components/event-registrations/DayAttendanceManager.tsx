/**
 * One registration's days: what the attendee holds on each, whether they are
 * waiting for a seat, when it was last changed — and what a manager may do
 * about it.
 *
 * The list works the way every list in the portal works (#113): a row's own
 * `…` menu changes that day; the checkboxes select several days and the
 * bulk bar changes them together, in one request and one email. Every
 * change is asked about before it is made — a method to move to, a reason
 * to admit beyond capacity, a confirmation to leave a day — so nothing
 * happens the instant a menu item is chosen and a single day and a group of
 * days are changed through the same dialogs.
 */
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
import { formatServiceDate } from "../../../shared/format-date";
import { DataTable } from "../Table";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { BulkBar } from "../../ui/BulkBar";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Menu, type MenuItem } from "../../ui/Menu";
import { RowActions } from "../../ui/RowActions";
import { Select, Textarea } from "../../ui/TextControl";

// `pk-mono` on the date stamps comes from the content stylesheet, which is
// not in the entry chunk, so this module has to pull it in.
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

interface DayRow {
  dayDate: string;
  label: string | null;
  subject: string;
  supportsInPerson: boolean;
  inPersonCapacity: number | null;
  current: DayOption;
  options: EventDay["attendanceOptions"];
  waitlist: AttendanceDetail["dayWaitlist"][number] | null;
  activeWaitlist: boolean;
  heldSince: string | null;
  changedAt: string | null;
}

type OpenDialog = { kind: "change"; days: DayRow[]; choice: string } | { kind: "vip"; days: DayRow[]; reason: string };

/** "Tuesday 1 December and Wednesday 2 December", for a dialog's sentence. */
function nameDays(days: readonly DayRow[]): string {
  const names = days.map((day) => day.subject);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function countDays(count: number): string {
  return `${String(count)} ${count === 1 ? "day" : "days"}`;
}

export function DayAttendanceManager({
  dayAttendance,
  dayWaitlist,
  eventDays,
  registrationEndpoint,
  canVip = false,
  onReload,
  onSuccess,
}: DayAttendanceManagerProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "danger" } | null>(null);
  const vip = dialog?.kind === "vip" ? dialog : null;
  // One basis for validation: the shared admission contract the server parses
  // decides what the reason field shows, live, and what the override may send.
  const vipForm = useContractForm(eventRegistrationSelectedDayAdmitSchema, {
    mode: "vip",
    reason: vip?.reason ?? "",
    dayDates: vip?.days.map((day) => day.dayDate) ?? [],
  });

  if (!eventDays.length) return <p class="pk pk-small">No event days configured.</p>;

  const attendanceByDate = new Map(dayAttendance.map((day) => [day.dayDate, day]));
  const waitlistByDate = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry]));
  const rows: DayRow[] = eventDays.map((day) => {
    const inPerson = day.attendanceOptions.find((option) => option.value === "in_person");
    const held = attendanceByDate.get(day.date);
    const waitlist = waitlistByDate.get(day.date) ?? null;
    return {
      dayDate: day.date,
      label: day.label,
      subject: day.label ?? formatServiceDate(day.date),
      supportsInPerson: Boolean(inPerson),
      inPersonCapacity: inPerson?.capacity ?? null,
      current: held?.attendanceType ?? ("none" as DayOption),
      options: day.attendanceOptions,
      waitlist,
      activeWaitlist: waitlist?.status === "waiting" || waitlist?.status === "offered",
      heldSince: held?.heldSince ?? null,
      changedAt: held?.changedAt ?? null,
    };
  });
  const rowsByDate = new Map(rows.map((day) => [day.dayDate, day]));
  const selectedRows = rows.filter((day) => selected.has(day.dayDate));

  // What each command may act on, so a command that applies to none of the
  // chosen days is absent from the menu rather than failing on the server.
  const canChange = (days: readonly DayRow[]) => changeChoices(days).length > 0;
  const admittable = (days: readonly DayRow[]) =>
    days.filter((day) => day.activeWaitlist && day.current === "in_person");
  const returnable = (days: readonly DayRow[]) =>
    days.filter(
      (day) =>
        !day.activeWaitlist && day.current === "in_person" && day.inPersonCapacity != null && day.inPersonCapacity > 0,
    );
  const overridable = (days: readonly DayRow[]) => days.filter((day) => day.supportsInPerson);
  const leavable = (days: readonly DayRow[]) => days.filter((day) => day.current !== "none");

  /** The methods every chosen day offers, less the one they all already hold. */
  function changeChoices(days: readonly DayRow[]): Array<{ value: string; label: string }> {
    if (days.length === 0) return [];
    const shared = days[0].options.filter((option) =>
      days.every((day) => day.options.some((o) => o.value === option.value)),
    );
    const same = days.every((day) => day.current === days[0].current) ? days[0].current : null;
    return shared
      .filter((option) => option.value !== same)
      .map((option) => ({ value: option.value, label: option.label }));
  }

  async function reloadWithSuccess(text: string): Promise<void> {
    onSuccess?.(text);
    await onReload();
    setSelected(new Set());
    setMessage({ text, kind: "success" });
  }

  async function run(request: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await request();
      await reloadWithSuccess(success);
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: "danger" });
    } finally {
      setBusy(false);
    }
  }

  function patchDays(days: readonly DayRow[], action: string) {
    return patchJson(
      `${registrationEndpoint}/day-attendance`,
      { action, dayDates: days.map((day) => day.dayDate) },
      eventRegistrationDayAttendanceResponseSchema,
    );
  }

  // ── The commands, each asked about before it runs ──────────────────────

  function openChange(days: DayRow[]): void {
    const choices = changeChoices(days);
    if (choices.length === 0) return;
    setDialog({ kind: "change", days, choice: choices[0].value });
  }

  async function applyChange(): Promise<void> {
    if (dialog?.kind !== "change") return;
    const { days, choice } = dialog;
    const label = changeChoices(days).find((option) => option.value === choice)?.label ?? choice;
    setDialog(null);
    await run(
      () => patchDays(days, choice),
      `${countDays(days.length)} changed to ${label.toLowerCase()}; the registration update email was queued.`,
    );
  }

  async function admitFromWaitlist(days: readonly DayRow[]): Promise<void> {
    const targets = admittable(days);
    if (targets.length === 0) return;
    const confirmed = await confirmAction({
      title: `Admit ${nameDays(targets)} from the waitlist?`,
      body: "The attendee takes a seat in person on each of these days.",
      consequences: ["One registration update email is sent for the change."],
      confirmLabel: "Admit from waitlist",
      tone: "primary",
    });
    if (!confirmed) return;
    await run(
      () =>
        postJson(
          `${registrationEndpoint}/admissions`,
          {
            mode: "capacity_exempt",
            reason: "Event manager approved in-person admission",
            dayDates: targets.map((day) => day.dayDate),
          },
          eventRegistrationAdmitResponseSchema,
        ),
      `${countDays(targets.length)} admitted; the registration update email was queued.`,
    );
  }

  async function returnToWaitlist(days: readonly DayRow[]): Promise<void> {
    const targets = returnable(days);
    if (targets.length === 0) return;
    const confirmed = await confirmAction({
      title: `Return ${nameDays(targets)} to the waitlist?`,
      body: "The attendee gives up the in-person seat and waits for one again.",
      consequences: ["One registration update email is sent for the change."],
      confirmLabel: "Return to waitlist",
      tone: "primary",
    });
    if (!confirmed) return;
    await run(
      () => patchDays(targets, "waitlist"),
      `${countDays(targets.length)} returned to the waitlist; the registration update email was queued.`,
    );
  }

  function openVip(days: readonly DayRow[]): void {
    const targets = overridable(days);
    if (targets.length === 0) return;
    setDialog({ kind: "vip", days: targets, reason: "" });
  }

  async function applyVipOverride(): Promise<void> {
    const checked = vipForm.submit();
    if (!checked.data) return;
    const count = checked.data.dayDates.length;
    setDialog(null);
    vipForm.reset();
    await run(
      () => postJson(`${registrationEndpoint}/admissions`, checked.data, eventRegistrationAdmitResponseSchema),
      `VIP override applied to ${countDays(count)}; the registration update email was queued.`,
    );
  }

  async function leaveDays(days: readonly DayRow[]): Promise<void> {
    const targets = leavable(days);
    if (targets.length === 0) return;
    const confirmed = await confirmAction({
      title: `Mark ${nameDays(targets)} as not attending?`,
      body: "The attendee no longer holds these days.",
      consequences: ["Any waitlist place on these days is given up.", "One registration update email is sent."],
      confirmLabel: "Not attending",
    });
    if (!confirmed) return;
    await run(
      () => patchDays(targets, "remove"),
      `${countDays(targets.length)} marked as not attending; the registration update email was queued.`,
    );
  }

  /**
   * The commands for a set of days — one day from its row, several from the
   * bulk bar — in the order a manager reaches for them. A command that
   * applies to none of the days is left out, so the menu reads as the days'
   * state.
   */
  function commandsFor(days: DayRow[]): MenuItem[] {
    const items: MenuItem[] = [];
    if (canChange(days)) {
      items.push({ id: "change", label: "Change attendance…", disabled: busy, onSelect: () => openChange(days) });
    }
    if (admittable(days).length > 0) {
      items.push({
        id: "admit",
        label: "Admit from waitlist…",
        disabled: busy,
        onSelect: () => void admitFromWaitlist(days),
      });
    }
    if (returnable(days).length > 0) {
      items.push({
        id: "waitlist",
        label: "Return to waitlist…",
        disabled: busy,
        onSelect: () => void returnToWaitlist(days),
      });
    }
    if (canVip && overridable(days).length > 0) {
      items.push({ id: "vip", label: "Admit beyond capacity…", disabled: busy, onSelect: () => openVip(days) });
    }
    if (leavable(days).length > 0) {
      items.push({
        id: "remove",
        label: "Not attending…",
        danger: true,
        separatorBefore: items.length > 0,
        disabled: busy,
        onSelect: () => void leaveDays(days),
      });
    }
    return items;
  }

  function attendanceLabel(day: DayRow): string {
    if (day.current === "none") return "Not attending";
    return day.options.find((option) => option.value === day.current)?.label ?? day.current.replaceAll("_", " ");
  }

  /**
   * When the day last changed, with the day it was first held under it when
   * that is a different day — one column, since a held day's two dates are
   * usually the same one and a record's main column has no room for two
   * columns of timestamps.
   */
  const changed = (day: DayRow) => {
    if (!day.changedAt) {
      return (
        <>
          <span class="pk-muted" aria-hidden="true">
            —
          </span>
          <span class="pk-sr-only">Not held</span>
        </>
      );
    }
    const heldEarlier = day.heldSince && day.heldSince.slice(0, 10) !== day.changedAt.slice(0, 10);
    return (
      <div class="pk-stack pk-stack--tight">
        <span class="pk-nowrap">{formatDateTime(day.changedAt)}</span>
        {heldEarlier && <span class="pk-small pk-muted pk-nowrap">Held since {formatServiceDate(day.heldSince!)}</span>}
      </div>
    );
  };

  const bulkCommands = commandsFor(selectedRows);
  const bulkPrimary = bulkCommands.find((item) => item.id === "change");
  const bulkRest = bulkCommands.filter((item) => item.id !== "change");

  return (
    <div class="pk-table-list">
      {/*
       * Outcome messages name what happened, so the tone reinforces the words
       * rather than carrying the meaning on its own. Alert also picks the
       * right live-region role per tone: a failure interrupts, a success does
       * not.
       */}
      {message && <Alert tone={message.kind === "success" ? "ok" : "danger"}>{message.text}</Alert>}
      {selected.size > 0 && (
        <BulkBar count={selected.size} total={rows.length} onClear={() => setSelected(new Set())}>
          {bulkPrimary && (
            <Button size="sm" variant="secondary" disabled={bulkPrimary.disabled} onClick={bulkPrimary.onSelect}>
              {bulkPrimary.label}
            </Button>
          )}
          {bulkRest.length > 0 && <Menu label="More actions for the selected days" items={bulkRest} align="end" />}
        </BulkBar>
      )}
      <DataTable
        caption="Attendance by event day"
        columns={[
          {
            // The day's own name over its date: two facts about one thing,
            // in one column.
            // Not the slack column: a day's name is short, and the primary
            // column's reading-measure floor pushed the two timestamps off
            // the record's main column on a laptop.
            header: "Day",
            cell: (day) => (
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong">{day.subject}</span>
                <span class="pk-small pk-muted pk-mono">{day.dayDate}</span>
              </div>
            ),
          },
          {
            header: "Attendance",
            cell: (day) => <span class={day.current === "none" ? "pk-muted" : undefined}>{attendanceLabel(day)}</span>,
          },
          {
            header: "Waitlist",
            cell: (day) =>
              day.waitlist ? (
                <div class="pk-stack pk-stack--tight pk-small">
                  <div class="pk-cluster">
                    <Badge status={day.waitlist.status} />
                    <span class="pk-muted">{day.waitlist.priorityLane} lane</span>
                  </div>
                  {day.waitlist.offerExpiresAt && (
                    <span class="pk-muted">Offer expires {formatDateTime(day.waitlist.offerExpiresAt)}</span>
                  )}
                </div>
              ) : (
                <>
                  <span class="pk-muted" aria-hidden="true">
                    —
                  </span>
                  <span class="pk-sr-only">Not waitlisted</span>
                </>
              ),
          },
          { header: "Last changed", width: "fit", className: "pk-small pk-muted", cell: changed },
          {
            header: "",
            className: "pk-end",
            width: "fit",
            cell: (day) => <RowActions subject={day.subject} actions={commandsFor([day])} />,
          },
        ]}
        data={rows}
        rowKey={(day) => day.dayDate}
        selection={{
          selected,
          onChange: setSelected,
          rowLabel: (dayDate) => `Select ${rowsByDate.get(dayDate)?.subject ?? dayDate}`,
        }}
      />
      {dialog?.kind === "change" && (
        <Dialog
          open
          title="Change attendance"
          description={`${nameDays(dialog.days)}: the attendee moves to the chosen method. One registration update email is sent.`}
          confirmLabel="Change attendance"
          confirmDisabled={busy}
          onConfirm={() => void applyChange()}
          onCancel={() => setDialog(null)}
        >
          <Field label="Attendance method">
            {(control) => (
              <Select
                {...control}
                value={dialog.choice}
                disabled={busy}
                onChange={(event) =>
                  setDialog((current) =>
                    current?.kind === "change"
                      ? { ...current, choice: (event.target as HTMLSelectElement).value }
                      : current,
                  )
                }
              >
                {changeChoices(dialog.days).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Dialog>
      )}
      {vip && (
        <Dialog
          open
          title="Admit beyond capacity"
          description={`Seats the attendee in person on ${nameDays(vip.days)} although the day is full, with a recorded reason. This is audited and sends one registration update email.`}
          confirmLabel="Apply VIP override"
          confirmDisabled={!vipForm.valid || busy}
          onConfirm={() => void applyVipOverride()}
          onCancel={() => {
            setDialog(null);
            vipForm.reset();
          }}
        >
          {/* The contract's handlers sit on the group so every control in it
              reports being touched; the reason is the one they name. */}
          <div class="pk-stack pk-stack--snug" {...vipForm.handlers}>
            <Field label="Required reason" required help="At least three characters." {...vipForm.of("reason")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="reason"
                  rows={2}
                  minLength={3}
                  maxLength={1000}
                  value={vip.reason}
                  disabled={busy}
                  onInput={(event) =>
                    setDialog((current) =>
                      current?.kind === "vip"
                        ? { ...current, reason: (event.target as HTMLTextAreaElement).value }
                        : current,
                    )
                  }
                />
              )}
            </Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}
