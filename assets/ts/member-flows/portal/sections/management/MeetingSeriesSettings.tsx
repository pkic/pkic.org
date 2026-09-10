import { useEffect, useState } from "preact/hooks";
import {
  eventSeriesMaterializeResponseSchema,
  eventSeriesMaterializeSchema,
  eventSeriesResponseSchema,
  eventSeriesUpdateSchema,
  type GroupEventSeries,
  EVENT_PROFILE_LABELS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { MeetingSeriesFields, ELIGIBILITY_LABELS, GUEST_LABELS } from "./MeetingSeriesFields";
import { defaultFutureDate, isoDateTimeValue } from "./meeting-form-utils";
import { draftFromSeries, seriesChanges } from "./meeting-series-draft";
import { useContractForm } from "../../../../hooks/useContractForm";
import { EditActions } from "../../../../ui/EditActions";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { describeRecurrenceShape, matchRecurrenceShape } from "../../../../components/RecurrenceEditor";
// The `pk-check` trio below is written as class names rather than reached
// through a component, so this module names their stylesheet itself.
import "../../../../ui/Field.css";

export function MeetingSeriesSettings({
  groupId,
  series,
  onChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFromSeries(series));
  const [active, setActive] = useState(series.active);
  const [through, setThrough] = useState(() => defaultFutureDate(180, 23, 59, series.timezone));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}`;

  const form = useContractForm(eventSeriesUpdateSchema, seriesChanges(series, draft, active));
  function reset() {
    setDraft(draftFromSeries(series));
    setActive(series.active);
    form.reset();
    setError("");
  }

  useEffect(() => {
    setDraft(draftFromSeries(series));
    setActive(series.active);
    setEditing(false);
  }, [series.id, series.updatedAt]);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (Object.keys(checked.data).length === 1) {
        toast("No meeting series changes to save", "info");
        setEditing(false);
        return;
      }
      await patchJson(base, checked.data, eventSeriesResponseSchema);
      toast("Meeting series updated", "success");
      setEditing(false);
      await onChanged();
    } catch (caught) {
      const message = form.refuse(caught);
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function materialize(): Promise<void> {
    setMaterializing(true);
    setError("");
    try {
      const input = eventSeriesMaterializeSchema.parse({
        through: isoDateTimeValue(through, series.timezone),
        maxOccurrences: 200,
      });
      const result = await postJson(`${base}/materialize`, input, eventSeriesMaterializeResponseSchema);
      toast(`${result.created} occurrence${result.created === 1 ? "" : "s"} created`, "success");
      await onChanged();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setMaterializing(false);
    }
  }

  const recurrence = matchRecurrenceShape(series.recurrenceRule);
  const activeId = `meeting-series-active-${series.id}`;
  const generateHeadingId = `meeting-series-generate-${series.id}`;

  return (
    <div class="pk pk-stack">
      <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void save(event)}>
        <PanelHeader title="Series settings" headingLevel={3}>
          <EditActions
            label="Meeting series actions"
            editing={editing}
            saving={saving}
            saveLabel="Save series"
            onEdit={() => {
              reset();
              setEditing(true);
            }}
            onCancel={() => {
              reset();
              setEditing(false);
            }}
          />
        </PanelHeader>
        {editing ? (
          <>
            <MeetingSeriesFields
              draft={draft}
              disabled={saving}
              scheduleLocked={series.occurrenceCount > 0}
              onChange={setDraft}
              fieldProps={{
                name: form.of("eventName"),
                profileKey: form.of("profileKey"),
                startsAt: form.of("startsAt"),
                timezone: form.of("timezone"),
                durationMinutes: form.of("durationMinutes"),
                location: form.of("location"),
                registrationPolicy: form.of("policy.registrationPolicy"),
                visibility: form.of("policy.visibility"),
                memberEligibility: form.of("policy.memberEligibility"),
                guestPolicy: form.of("policy.guestPolicy"),
              }}
            />
            {/* A note about the whole form, not the help text of one control:
            `pk-field__help` belongs to a control inside a `pk-field`. */}
            {series.occurrenceCount > 0 && (
              <p class="pk-muted pk-small">
                The recurring schedule is locked after occurrences are generated. Mutable policy, profile, name,
                location, and active state remain editable.
              </p>
            )}
            <Checkbox
              id={activeId}
              name="active"
              checked={active}
              onChange={(e) => setActive(e.currentTarget.checked)}
              label="Active series"
            />
          </>
        ) : (
          <DescriptionList
            items={[
              { term: "Meeting name", value: series.eventName },
              { term: "Event profile", value: EVENT_PROFILE_LABELS[series.profileKey] },
              { term: "First occurrence", value: formatDateTimeInZone(series.startsAt, series.timezone) },
              { term: "Repeats", value: recurrence ? describeRecurrenceShape(recurrence) : series.recurrenceRule },
              { term: "Time zone", value: series.timezone },
              { term: "Duration", value: `${series.durationMinutes} minutes` },
              { term: "Location", value: series.location },
              { term: "Registration", value: EVENT_REGISTRATION_POLICY_LABELS[series.registrationPolicy] },
              { term: "Visibility", value: EVENT_VISIBILITY_LABELS[series.visibility] },
              { term: "Attendee eligibility", value: ELIGIBILITY_LABELS[series.memberEligibility ?? "owner_group"] },
              { term: "External guests", value: GUEST_LABELS[series.guestPolicy ?? "none"] },
              { term: "Status", value: series.active ? "Active" : "Inactive" },
            ]}
          />
        )}
        {error && <ErrorAlert error={error} />}
      </form>
      {/* The rule the Bootstrap version drew with `border-top` is the panel's
          own edge, and the padding that followed it is the panel body's. */}
      <Panel aria-labelledby={generateHeadingId}>
        <PanelBody class="pk-stack pk-stack--snug">
          {/* The heading stays an h6 rather than moving to PanelHeader's h3:
              this editor already sits under the shell's h4 section title and a
              series' own h5, and a panel that jumped back to h3 would read as
              a sibling of the page rather than a part of this form. */}
          <h6 id={generateHeadingId}>Generate recurring occurrences</h6>
          <Field label="Generate through">
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={through}
                onInput={(e) => setThrough(e.currentTarget.value)}
              />
            )}
          </Field>
          <div class="pk-cluster">
            <Button variant="secondary" size="sm" loading={materializing} onClick={() => void materialize()}>
              {materializing ? "Generating…" : "Generate occurrences"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
