import { useEffect, useState } from "preact/hooks";
import {
  eventOccurrenceResponseSchema,
  eventOccurrenceUpdateSchema,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { patchJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { toast } from "../../ui";
import { MeetingOccurrenceFields, type MeetingOccurrenceDraft } from "./MeetingOccurrenceFields";
import { isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

function draftFromOccurrence(occurrence: EventOccurrence, timeZone: string): MeetingOccurrenceDraft {
  return {
    startsAt: localDateTimeValue(occurrence.startsAt, timeZone),
    endsAt: localDateTimeValue(occurrence.endsAt, timeZone),
    location: occurrence.locationOverride ?? "",
    providerUrlAction: occurrence.providerConfigured ? "keep" : "replace",
    providerJoinUrl: "",
    status: occurrence.status,
  };
}

export function MeetingOccurrenceEditor({
  endpoint,
  occurrence,
  timeZone,
  onChanged,
}: {
  endpoint: string;
  occurrence: EventOccurrence;
  timeZone: string;
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFromOccurrence(occurrence, timeZone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(draftFromOccurrence(occurrence, timeZone));
  }, [occurrence.id, occurrence.updatedAt, timeZone]);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const changes: Record<string, unknown> = { expectedUpdatedAt: occurrence.updatedAt };
      const startsAt = isoDateTimeValue(draft.startsAt, timeZone);
      const endsAt = isoDateTimeValue(draft.endsAt, timeZone);
      if (startsAt !== occurrence.startsAt) changes.startsAt = startsAt;
      if (endsAt !== occurrence.endsAt) changes.endsAt = endsAt;
      if (draft.status !== occurrence.status) changes.status = draft.status;
      const location = draft.location.trim() || null;
      if (location !== occurrence.locationOverride) changes.locationOverride = location;
      if (draft.providerUrlAction === "replace" && draft.providerJoinUrl.trim()) {
        changes.providerJoinUrl = draft.providerJoinUrl.trim();
      }
      if (draft.providerUrlAction === "remove") changes.providerJoinUrl = null;
      if (Object.keys(changes).length === 1) {
        toast("No occurrence changes to save", "info");
        return;
      }
      const input = eventOccurrenceUpdateSchema.parse(changes);
      await patchJson(endpoint, input, eventOccurrenceResponseSchema);
      toast("Meeting occurrence updated", "success");
      await onChanged();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" onSubmit={(event) => void save(event)}>
      <MeetingOccurrenceFields
        idPrefix={`meeting-occurrence-settings-${occurrence.id}`}
        draft={draft}
        existing
        providerConfigured={occurrence.providerConfigured}
        disabled={saving}
        onChange={setDraft}
      />
      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={saving}>
          {saving ? "Saving…" : "Save occurrence"}
        </Button>
      </div>
      {/* The failure sits below the actions rather than beside them: an alert
          is a block, and sharing the button's row pushed the button off the
          line as soon as the message ran to a second one. */}
      {error && <ErrorAlert error={error} />}
    </form>
  );
}
