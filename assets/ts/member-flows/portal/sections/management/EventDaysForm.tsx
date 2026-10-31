import { useState } from "preact/hooks";
import type { EventDaysManagementResponse } from "../../../../../shared/schemas/event-configuration";
import {
  groupEventDaysReplaceResponseSchema,
  groupEventDaysReplaceSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import { formatNumber } from "../../../../../shared/format-number";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { writeHashQueryParam } from "../../../../ui/url-query";
import { useMediaQuery } from "../../../../hooks/useMediaQuery";
import { putJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { IconPlus } from "../../../../components/icons";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { SectionHeading } from "../../../../ui/SectionHeading";
import { TabList } from "../../../../ui/TabList";
import { EventAttendanceOptions } from "./EventAttendanceOptions";
import { EventAttendanceSchedule } from "./EventAttendanceSchedule";
import {
  addAttendanceDay,
  attendanceConfiguration,
  attendanceSettingsDraft,
  dayOptionEntries,
  type AttendanceDayDraft,
  type AttendanceDefinition,
} from "./event-attendance-draft";
import "./EventAttendanceSettings.css";

export function EventDaysForm({
  endpoint,
  event,
  response,
  expectedUpdatedAt,
  onRevision,
  onCancel,
  onSaved,
}: {
  endpoint: string;
  event: Pick<GroupEvent, "timezone">;
  response: EventDaysManagementResponse;
  expectedUpdatedAt: string;
  onRevision: (revision: string) => void;
  onCancel: () => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => attendanceSettingsDraft(response, event.timezone));
  const [initial] = useState(() => JSON.stringify(attendanceConfiguration(draft)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [active, setActive] = useHashQueryParam("attendanceSettings", "schedule", ["schedule", "options"]);
  const [selectedDay, selectDay] = useHashQueryParam(
    "attendanceDay",
    draft.days[0]?.id ?? "",
    draft.days.map((day) => day.id),
  );
  const phone = useMediaQuery("(max-width: 52rem)");
  const configuration = attendanceConfiguration(draft);
  const dirty = JSON.stringify(configuration) !== initial;
  const form = useContractForm(
    groupEventDaysReplaceSchema,
    { expectedUpdatedAt, configuration },
    {
      revealField(name) {
        const match = /^configuration\.days\.(\d+)(?:\.attendanceOptions\.(\d+)\.(\w+))?/.exec(name);
        if (!match) return;
        const index = Number(match[1]);
        const day = draft.days[index];
        if (!day) return;
        if (match[2] !== undefined && match[3] !== "capacity" && match[3] !== "enabled") {
          setActive("options");
          setExpanded(dayOptionEntries(draft, index)[Number(match[2])]?.definition.id ?? null);
        } else {
          setActive("schedule");
          selectDay(day.id);
        }
      },
    },
  );

  function addDay() {
    const next = addAttendanceDay(draft);
    setDraft(next);
    setActive("schedule");
    writeHashQueryParam("attendanceDay", next.days.length === 1 ? null : next.days[next.days.length - 1].id);
  }
  function addOption() {
    const definition: AttendanceDefinition = {
      id: crypto.randomUUID(),
      originalValue: "",
      option: { value: "", label: "" },
    };
    setDraft((current) => ({ ...current, definitions: [...current.definitions, definition] }));
    setExpanded(definition.id);
    setActive("options");
  }
  function updateDay(id: string, patch: Partial<AttendanceDayDraft>) {
    setDraft((current) => ({
      ...current,
      days: current.days
        .map((day) => (day.id === id ? { ...day, ...patch } : day))
        .sort((a, b) => (!a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date))),
    }));
  }
  function updateChoice(dayId: string, definitionId: string, patch: Partial<AttendanceDayDraft["choices"][string]>) {
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id !== dayId
          ? day
          : {
              ...day,
              choices: {
                ...day.choices,
                [definitionId]: { ...(day.choices[definitionId] ?? { enabled: false, capacity: null }), ...patch },
              },
            },
      ),
    }));
  }
  async function save(event: Event) {
    event.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const result = await putJson(endpoint, checked.data, groupEventDaysReplaceResponseSchema);
      onRevision(result.eventUpdatedAt);
      if (!result.skipped.length) await onSaved();
      else setStatus(`Saved; retained dates in use: ${result.skipped.join(", ")}.`);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      class="pk pk-stack pk-attendance-settings"
      noValidate
      {...form.handlers}
      onSubmit={(event) => void save(event)}
    >
      <SectionHeading level={3}>Attendance days</SectionHeading>
      <ErrorAlert error={error} />
      <TabList
        label="Attendance settings"
        idPrefix="attendance-settings"
        activeId={active}
        onSelect={(id) => setActive(id === "options" ? "options" : "schedule")}
        items={[
          { id: "schedule", label: "Schedule", panelId: "attendance-schedule" },
          {
            id: "options",
            label: `Options · ${formatNumber(draft.definitions.length)}`,
            panelId: "attendance-options",
          },
        ]}
      />
      <fieldset class="pk-fieldset" disabled={saving}>
        {active === "schedule" ? (
          <Panel
            id="attendance-schedule"
            role="tabpanel"
            aria-labelledby="attendance-settings-schedule"
            class="pk-attendance-settings__schedule"
          >
            <PanelHeader title="Schedule and capacity">
              {!phone && (
                <Button onClick={addDay}>
                  <IconPlus width="16" height="16" />
                  Add day
                </Button>
              )}
            </PanelHeader>
            <PanelBody>
              <p class="pk-small" id="attendance-times-zone">
                Choose which options each day offers. Leave capacity empty for unlimited places. Times are local to{" "}
                {event.timezone}.
              </p>
            </PanelBody>
            {!draft.days.length && (
              <PanelBody>
                <EmptyState
                  title="No attendance days configured"
                  body="Add a day to configure its attendance options."
                />
                {phone && (
                  <Button onClick={addDay}>
                    <IconPlus width="16" height="16" />
                    Add day
                  </Button>
                )}
              </PanelBody>
            )}
            {draft.days.length > 0 && (
              <EventAttendanceSchedule
                draft={draft}
                phone={phone}
                zone={event.timezone}
                selectedDay={selectedDay}
                onSelectDay={selectDay}
                onAddDay={addDay}
                field={form.of}
                onDayChange={updateDay}
                onChoiceChange={updateChoice}
                onDayRemove={(id) =>
                  setDraft((current) => ({ ...current, days: current.days.filter((day) => day.id !== id) }))
                }
              />
            )}
            {draft.days.length > 0 && !draft.definitions.length && (
              <PanelBody>
                <Button
                  onClick={() => {
                    setActive("options");
                    addOption();
                  }}
                >
                  Add attendance option
                </Button>
              </PanelBody>
            )}
          </Panel>
        ) : (
          <Panel
            id="attendance-options"
            role="tabpanel"
            aria-labelledby="attendance-settings-options"
            class="pk-attendance-settings__options"
          >
            <PanelHeader title="Attendance options">
              <Button onClick={addOption} disabled={!draft.days.length}>
                <IconPlus width="16" height="16" />
                Add option
              </Button>
            </PanelHeader>
            <PanelBody>
              <p class="pk-small">Define options once, then turn them on for each day in Schedule.</p>
            </PanelBody>
            {!draft.days.length ? (
              <PanelBody>
                <p class="pk-small pk-muted">Add a day before defining attendance options.</p>
              </PanelBody>
            ) : (
              <EventAttendanceOptions
                draft={draft}
                phone={phone}
                expanded={expanded}
                onExpand={setExpanded}
                field={form.of}
                onChange={(id, patch) =>
                  setDraft((current) => ({
                    ...current,
                    definitions: current.definitions.map((definition) =>
                      definition.id === id ? { ...definition, option: { ...definition.option, ...patch } } : definition,
                    ),
                  }))
                }
                onRemove={(id) =>
                  setDraft((current) => ({
                    ...current,
                    definitions: current.definitions.filter((definition) => definition.id !== id),
                  }))
                }
              />
            )}
            <PanelBody>
              <p class="pk-small pk-muted">
                Options with registrations cannot be removed. Turn them off for individual days instead.
              </p>
            </PanelBody>
          </Panel>
        )}
      </fieldset>
      <div
        class="pk-attendance-settings__footer"
        data-app-bottom-bar
        role="region"
        aria-label="Attendance settings actions"
      >
        <span class="pk-small pk-muted" role="status">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div class="pk-attendance-settings__actions">
          <Button onClick={() => void onCancel()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Save days
          </Button>
        </div>
      </div>
      {status && <Alert tone="warn">{status}</Alert>}
    </form>
  );
}
