/** Member account email, shared passkey management, and notifications. */
import { useEffect, useState } from "preact/hooks";
import { PasskeySettings } from "../../../components/passkey-settings";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { ApiClientError, getJson, patchJson } from "../../../shared/api-client";
import { profile } from "../state";
import type { NotificationPreferences } from "../types";
import { toast } from "../ui";

const PREFERENCE_LABELS: Record<keyof NotificationPreferences, string> = {
  workingGroupUpdates: "Working group updates",
  voteReminders: "Vote reminders",
  generalAnnouncements: "General consortium announcements",
  wgChairMembershipDigest: "Working group roster change digest (chairs & vice-chairs only, weekly)",
};

function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    getJson<NotificationPreferences>("/api/v1/me/notification-preferences")
      .then(setPreferences)
      .catch((reason: unknown) =>
        setError(reason instanceof ApiClientError ? reason.message : "Could not load preferences."),
      );
  }, []);

  async function toggle(key: keyof NotificationPreferences, next: boolean): Promise<void> {
    setSavingKey(key);
    try {
      const updated = await patchJson<NotificationPreferences>("/api/v1/me/notification-preferences", { [key]: next });
      setPreferences(updated);
    } catch (reason) {
      toast(reason instanceof ApiClientError ? reason.message : "Could not update preference.", "error");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Notification preferences</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {!preferences && !error ? (
          <Spinner />
        ) : (
          preferences && (
            <div class="d-flex flex-column gap-2">
              {(Object.keys(PREFERENCE_LABELS) as Array<keyof NotificationPreferences>).map((key) => (
                <div class="form-check form-switch" key={key}>
                  <input
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    id={`portal-notif-${key}`}
                    checked={preferences[key]}
                    disabled={savingKey === key}
                    onChange={(event) => void toggle(key, (event.target as HTMLInputElement).checked)}
                  />
                  <label class="form-check-label small" for={`portal-notif-${key}`}>
                    {PREFERENCE_LABELS[key]}
                  </label>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function AccountSettings() {
  return (
    <div class="d-flex flex-column gap-3 content-width-md">
      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Email</div>
        <div class="card-body">
          <p class="mb-0">{profile.value?.email}</p>
          <p class="text-muted small mb-0">
            Your email address is tied to your membership record. Contact PKI Consortium staff to change it.
          </p>
        </div>
      </div>

      <PasskeySettings toastTargetId="portal-toast-area" />
      <NotificationPreferencesCard />
    </div>
  );
}
