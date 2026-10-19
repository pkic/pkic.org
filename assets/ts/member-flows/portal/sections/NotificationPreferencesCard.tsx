/**
 * The person's email notification choices, saved as each one is changed.
 *
 * A choice is a checkbox in a row; there is no edit mode and no Save, so a
 * change is never left pending. A refused change is reported and the box
 * returns to what is stored.
 */
import { useEffect, useState } from "preact/hooks";
import { myNotificationPreferencesSchema, myNotificationPreferencesUpdateSchema } from "../../../../shared/schemas/me";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { getJson, patchJson } from "../../../shared/api-client";
import { Checkbox } from "../../../ui/Checkbox";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { RowList, RowListItem } from "../../../ui/RowList";
import type { NotificationPreferences } from "../types";
import { toast } from "../ui";

const ENDPOINT = "/api/v1/users/current/notifications/preferences";
const CHOICES: ReadonlyArray<{ key: keyof NotificationPreferences; label: string; hint?: string }> = [
  { key: "workingGroupUpdates", label: "Working group updates" },
  { key: "voteReminders", label: "Vote reminders" },
  { key: "generalAnnouncements", label: "General consortium announcements" },
  {
    key: "wgChairMembershipDigest",
    label: "Working group roster change digest",
    hint: "Weekly, for chairs and vice-chairs",
  },
];

export function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson(ENDPOINT, myNotificationPreferencesSchema)
      .then(setPreferences)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not load preferences.");
      });
  }, []);

  async function change(key: keyof NotificationPreferences, checked: boolean): Promise<void> {
    if (!preferences) return;
    // Shown as chosen at once; the stored value replaces it when the server answers.
    setPreferences((current) => (current ? { ...current, [key]: checked } : current));
    try {
      const body = myNotificationPreferencesUpdateSchema.parse({ [key]: checked });
      const stored = await patchJson(ENDPOINT, body, myNotificationPreferencesSchema);
      setPreferences((current) => (current ? { ...current, [key]: stored[key] } : current));
    } catch (cause) {
      setPreferences((current) => (current ? { ...current, [key]: !checked } : current));
      toast(cause instanceof Error ? cause.message : "Could not save your choice.", "error");
    }
  }

  return (
    <Panel aria-label="Email notifications">
      <PanelHeader title="Email notifications" headingLevel={2} />
      <PanelBody flush>
        {error && (
          <div class="pk-panel__body">
            <ErrorAlert error={error} />
          </div>
        )}
        {!preferences && !error && (
          <div class="pk-panel__body">
            <Spinner />
          </div>
        )}
        {preferences && (
          <RowList label="Email notifications">
            {CHOICES.map((choice) => (
              <RowListItem key={choice.key}>
                <Checkbox
                  name={choice.key}
                  checked={preferences[choice.key]}
                  onChange={(event) => void change(choice.key, event.currentTarget.checked)}
                  label={choice.label}
                  hint={choice.hint}
                />
              </RowListItem>
            ))}
          </RowList>
        )}
      </PanelBody>
    </Panel>
  );
}
