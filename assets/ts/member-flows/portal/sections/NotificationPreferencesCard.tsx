import { useEffect, useState } from "preact/hooks";
import { myNotificationPreferencesSchema, myNotificationPreferencesUpdateSchema } from "../../../../shared/schemas/me";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { useContractForm } from "../../../hooks/useContractForm";
import { Checkbox } from "../../../ui/Checkbox";
import { DescriptionList } from "../../../ui/DescriptionList";
import { EditActions } from "../../../ui/EditActions";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { getJson, patchJson } from "../../../shared/api-client";
import type { NotificationPreferences } from "../types";
import { toast } from "../ui";

const ENDPOINT = "/api/v1/users/current/notifications/preferences";
const LABELS: Record<keyof NotificationPreferences, string> = {
  workingGroupUpdates: "Working group updates",
  voteReminders: "Vote reminders",
  generalAnnouncements: "General consortium announcements",
  wgChairMembershipDigest: "Working group roster change digest (chairs & vice-chairs only, weekly)",
};

export function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<Partial<NotificationPreferences>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(myNotificationPreferencesUpdateSchema, draft);
  useEffect(() => {
    getJson(ENDPOINT, myNotificationPreferencesSchema)
      .then(setPreferences)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not load preferences.");
      });
  }, []);

  async function save(event: Event) {
    event.preventDefault();
    if (!editing || !preferences || saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    try {
      setPreferences(await patchJson(ENDPOINT, checked.data, myNotificationPreferencesSchema));
      setEditing(false);
      toast("Notification preferences saved", "success");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate {...form.handlers} onSubmit={(event) => void save(event)}>
      <Panel aria-label="Notification preferences">
        <PanelHeader title="Notification preferences">
          {preferences && (
            <EditActions
              label="Notification preference actions"
              editing={editing}
              saving={saving}
              onEdit={() => {
                setDraft(preferences);
                setError(null);
                form.reset();
                setEditing(true);
              }}
              onCancel={() => {
                setEditing(false);
                setError(null);
                form.reset();
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack pk-stack--snug">
          {error && <ErrorAlert error={error} />}
          {!preferences && !error && <Spinner />}
          {preferences &&
            (editing ? (
              <div class="pk-stack pk-stack--snug">
                {(Object.keys(LABELS) as Array<keyof NotificationPreferences>).map((key) => (
                  <Checkbox
                    key={key}
                    name={key}
                    checked={draft[key] ?? false}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, [key]: event.currentTarget.checked })}
                    label={LABELS[key]}
                  />
                ))}
              </div>
            ) : (
              <DescriptionList
                items={(Object.keys(LABELS) as Array<keyof NotificationPreferences>).map((key) => ({
                  term: LABELS[key],
                  value: preferences[key] ? "On" : "Off",
                }))}
              />
            ))}
        </PanelBody>
      </Panel>
    </form>
  );
}
