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
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Select } from "../../../../ui/TextControl";
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

  if (loading) return <Spinner label="Loading registration settings…" />;
  if (!settings && error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <div class="pk pk-stack pk-stack--loose">
      <div class="pk-stack">
        {/* The sentence is the policy control's guidance, so it hangs off the
            control through aria-describedby rather than sitting above it as
            prose a screen reader never connects to the choice. */}
        <Field
          label="Registration policy"
          help="Enable registration after configuring at least one required attendee term. Custom registration questions are optional."
        >
          {(control) => (
            <Select
              {...control}
              value={registrationPolicy}
              disabled={saving}
              onChange={(event) => setRegistrationPolicy(event.currentTarget.value as EventRegistrationPolicy)}
            >
              {EVENT_REGISTRATION_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {EVENT_REGISTRATION_POLICY_LABELS[policy]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div class="pk-cluster">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void saveSettings()}>
            {saving ? "Saving…" : "Save registration settings"}
          </Button>
        </div>
        {error && <ErrorAlert error={error} />}
      </div>
      {/* The rule that used to separate the two halves is gone: the parent's
          gap says the same thing without a border on an inner element. */}
      {showFormConfiguration && (
        <EventFormPlacementEditor
          groupId={groupId}
          eventId={eventId}
          purpose="event_registration"
          expectedUpdatedAt={expectedUpdatedAt}
          onRevision={onRevision}
        />
      )}
    </div>
  );
}
