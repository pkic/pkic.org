import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventRegistrationSettingsResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
} from "../../../../../shared/schemas/group-events";
import {
  EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_POLICY_LABELS,
  type EventRegistrationPolicy,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { getJson, putJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { EventFormPlacementEditor } from "./EventFormPlacementEditor";

type RegistrationSettings = z.infer<typeof groupEventRegistrationSettingsResponseSchema>;

export function EventRegistrationSettingsEditor({
  groupId,
  eventId,
  expectedUpdatedAt,
  onRevision,
  showFormConfiguration = true,
}: {
  groupId: string;
  eventId: string;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
  showFormConfiguration?: boolean;
}) {
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registration-settings`;
  const [settings, setSettings] = useState<RegistrationSettings | null>(null);
  const [registrationPolicy, setRegistrationPolicy] = useState<EventRegistrationPolicy>("no_registration");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(base, groupEventRegistrationSettingsResponseSchema);
      setSettings(response);
      setRegistrationPolicy(response.registrationPolicy);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const input = groupEventRegistrationSettingsUpdateSchema.parse({ expectedUpdatedAt, registrationPolicy });
      const response = await putJson(base, input, groupEventRegistrationSettingsResponseSchema);
      setSettings(response);
      setRegistrationPolicy(response.registrationPolicy);
      onRevision(response.eventUpdatedAt);
      toast("Registration settings saved", "success");
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (!settings && error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <div class="d-flex flex-column gap-3">
      <p class="small text-muted mb-0">
        Enable registration after configuring at least one required attendee term. Custom registration questions are
        optional.
      </p>
      <div>
        <label class="form-label small fw-semibold" for={`event-registration-policy-${eventId}`}>
          Registration policy
        </label>
        <select
          id={`event-registration-policy-${eventId}`}
          class="form-select form-select-sm"
          value={registrationPolicy}
          disabled={saving}
          onChange={(event) => setRegistrationPolicy(event.currentTarget.value as EventRegistrationPolicy)}
        >
          {EVENT_REGISTRATION_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {EVENT_REGISTRATION_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-success align-self-start"
        disabled={saving}
        onClick={() => void saveSettings()}
      >
        {saving ? "Saving…" : "Save registration settings"}
      </button>
      {error && <ErrorAlert error={error} />}
      {showFormConfiguration && (
        <div class="border-top pt-3">
          <EventFormPlacementEditor
            groupId={groupId}
            eventId={eventId}
            purpose="event_registration"
            expectedUpdatedAt={expectedUpdatedAt}
            onRevision={onRevision}
          />
        </div>
      )}
    </div>
  );
}
