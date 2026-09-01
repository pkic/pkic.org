import { useEffect, useState } from "preact/hooks";
import {
  eventSeriesMaterializeResponseSchema,
  eventSeriesMaterializeSchema,
  eventSeriesResponseSchema,
  eventSeriesUpdateSchema,
  type GroupEventSeries,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { MeetingSeriesFields, type MeetingSeriesDraft } from "./MeetingSeriesFields";
import { defaultFutureDate, isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";
// The `pk-check` trio below is written as class names rather than reached
// through a component, so this module names their stylesheet itself.
import "../../../../ui/Field.css";

function draftFromSeries(series: GroupEventSeries): MeetingSeriesDraft {
  return {
    name: series.eventName,
    profileKey: series.profileKey,
    startsAt: localDateTimeValue(series.startsAt, series.timezone),
    recurrenceRule: series.recurrenceRule,
    timezone: series.timezone,
    durationMinutes: series.durationMinutes,
    location: series.location ?? "",
    registrationPolicy: series.registrationPolicy,
    visibility: series.visibility,
    memberEligibility: series.memberEligibility ?? "owner_group",
    guestPolicy: series.guestPolicy ?? "none",
  };
}

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
  const [saving, setSaving] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}`;

  useEffect(() => {
    setDraft(draftFromSeries(series));
    setActive(series.active);
  }, [series.id, series.updatedAt]);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const changes: Record<string, unknown> = { expectedUpdatedAt: series.updatedAt };
      if (draft.name !== series.eventName) changes.eventName = draft.name;
      if (draft.profileKey !== series.profileKey) changes.profileKey = draft.profileKey;
      if (series.occurrenceCount === 0) {
        const startsAt = isoDateTimeValue(draft.startsAt, draft.timezone);
        if (startsAt !== series.startsAt) changes.startsAt = startsAt;
        if (draft.recurrenceRule !== series.recurrenceRule) changes.recurrenceRule = draft.recurrenceRule;
        if (draft.timezone !== series.timezone) changes.timezone = draft.timezone;
        if (draft.durationMinutes !== series.durationMinutes) changes.durationMinutes = draft.durationMinutes;
      }
      const location = draft.location.trim() || null;
      if (location !== series.location) changes.location = location;
      if (
        draft.registrationPolicy !== series.registrationPolicy ||
        draft.visibility !== series.visibility ||
        draft.memberEligibility !== (series.memberEligibility ?? "owner_group") ||
        draft.guestPolicy !== (series.guestPolicy ?? "none")
      ) {
        changes.policy = {
          registrationPolicy: draft.registrationPolicy,
          visibility: draft.visibility,
          memberEligibility: draft.memberEligibility,
          guestPolicy: draft.guestPolicy,
        };
      }
      if (active !== series.active) changes.active = active;
      if (Object.keys(changes).length === 1) {
        toast("No meeting series changes to save", "info");
        return;
      }
      const input = eventSeriesUpdateSchema.parse(changes);
      await patchJson(base, input, eventSeriesResponseSchema);
      toast("Meeting series updated", "success");
      await onChanged();
    } catch (caught) {
      const message = (caught as Error).message;
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

  const activeId = `meeting-series-active-${series.id}`;
  const generateHeadingId = `meeting-series-generate-${series.id}`;

  return (
    <div class="pk pk-stack">
      <form class="pk-stack" onSubmit={(event) => void save(event)}>
        <MeetingSeriesFields
          idPrefix={`meeting-series-settings-${series.id}`}
          draft={draft}
          disabled={saving}
          scheduleLocked={series.occurrenceCount > 0}
          onChange={setDraft}
        />
        {series.occurrenceCount > 0 && (
          <p class="pk-field__help">
            The recurring schedule is locked after occurrences are generated. Mutable policy, profile, name, location,
            and active state remain editable.
          </p>
        )}
        {/* All three parts of the check block: `pk-check` on the label alone
            renders the operating system's own control, in its accent rather
            than ours, and no gate can see it. */}
        <label class="pk-check" for={activeId}>
          <input
            id={activeId}
            type="checkbox"
            class="pk-check__input"
            checked={active}
            onChange={(e) => setActive(e.currentTarget.checked)}
          />
          <span class="pk-check__label">Active series</span>
        </label>
        {/* `loading` rather than `disabled`: a disabled control loses focus,
            which throws a screen-reader user out of the form mid-save. */}
        <div class="pk-cluster">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {saving ? "Saving…" : "Save series"}
          </Button>
        </div>
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
