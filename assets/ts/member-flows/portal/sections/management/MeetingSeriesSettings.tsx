import { useEffect, useState } from "preact/hooks";
import {
  eventSeriesMaterializeResponseSchema,
  eventSeriesMaterializeSchema,
  eventSeriesResponseSchema,
  eventSeriesUpdateSchema,
  type GroupEventSeries,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { MeetingSeriesFields, type MeetingSeriesDraft } from "./MeetingSeriesFields";
import { defaultFutureDate, isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

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

  return (
    <div class="d-flex flex-column gap-3">
      <form class="d-flex flex-column gap-3" onSubmit={(event) => void save(event)}>
        <MeetingSeriesFields
          idPrefix={`meeting-series-settings-${series.id}`}
          draft={draft}
          disabled={saving}
          scheduleLocked={series.occurrenceCount > 0}
          onChange={setDraft}
        />
        {series.occurrenceCount > 0 && (
          <div class="form-text">
            The recurring schedule is locked after occurrences are generated. Mutable policy, profile, name, location,
            and active state remain editable.
          </div>
        )}
        <div>
          <div class="form-check">
            <input
              id={`meeting-series-active-${series.id}`}
              type="checkbox"
              class="form-check-input"
              checked={active}
              onChange={(e) => setActive(e.currentTarget.checked)}
            />
            <label class="form-check-label" for={`meeting-series-active-${series.id}`}>
              Active series
            </label>
          </div>
        </div>
        <div class="d-flex gap-2 align-items-center">
          <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
            {saving ? "Saving…" : "Save series"}
          </button>
          {error && <ErrorAlert error={error} />}
        </div>
      </form>
      <div class="border-top pt-3">
        <h6>Generate recurring occurrences</h6>
        <div class="d-flex flex-wrap align-items-end gap-2">
          <div>
            <label class="form-label small fw-semibold" for={`meeting-series-through-${series.id}`}>
              Generate through
            </label>
            <input
              id={`meeting-series-through-${series.id}`}
              type="datetime-local"
              class="form-control form-control-sm"
              value={through}
              onInput={(e) => setThrough(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={materializing}
            onClick={() => void materialize()}
          >
            {materializing ? "Generating…" : "Generate occurrences"}
          </button>
        </div>
      </div>
    </div>
  );
}
