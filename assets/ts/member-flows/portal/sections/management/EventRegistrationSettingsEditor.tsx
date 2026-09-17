import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventRegistrationSettingsResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
} from "../../../../../shared/schemas/group-events";
import {
  STANDALONE_EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_POLICY_LABELS,
  type EventRegistrationPolicy,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { EditActions } from "../../../../ui/EditActions";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { useContractForm } from "../../../../hooks/useContractForm";
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
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useContractForm(groupEventRegistrationSettingsUpdateSchema, { expectedUpdatedAt, registrationPolicy });

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

  async function saveSettings(event: Event): Promise<void> {
    event.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    try {
      const response = await putJson(base, checked.data, groupEventRegistrationSettingsResponseSchema);
      setSettings(response);
      setRegistrationPolicy(response.registrationPolicy);
      onRevision(response.eventUpdatedAt);
      setEditing(false);
      toast("Registration settings saved", "success");
    } catch (cause) {
      const message = form.refuse(cause);
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
      <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void saveSettings(event)}>
        <div class="pk-cluster pk-cluster--between">
          <h4>Registration policy</h4>
          <EditActions
            label="Registration policy actions"
            editing={editing}
            saving={saving}
            saveLabel="Save registration settings"
            onEdit={() => {
              form.reset();
              setError(null);
              setRegistrationPolicy(settings.registrationPolicy);
              setEditing(true);
            }}
            onCancel={() => {
              form.reset();
              setError(null);
              setRegistrationPolicy(settings.registrationPolicy);
              setEditing(false);
            }}
          />
        </div>
        {editing ? (
          <Field
            label="Registration policy"
            {...form.of("registrationPolicy")}
            help="Enable registration after configuring at least one required attendee term. Custom registration questions are optional."
          >
            {(control) => (
              <Select
                {...control}
                name="registrationPolicy"
                value={registrationPolicy}
                disabled={saving}
                onChange={(event) => setRegistrationPolicy(event.currentTarget.value as EventRegistrationPolicy)}
              >
                {STANDALONE_EVENT_REGISTRATION_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {EVENT_REGISTRATION_POLICY_LABELS[policy]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <DescriptionList
            items={[{ term: "Policy", value: EVENT_REGISTRATION_POLICY_LABELS[settings.registrationPolicy] }]}
          />
        )}
        {error && <ErrorAlert error={error} />}
      </form>
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
