/**
 * Account Settings — email (read-only), passkeys, notification preferences
 * . The passkey enrollment/list/remove UI mirrors
 * admin/sections/AccountSettings.tsx's startRegistration() pattern exactly;
 * it now works for members too since generalized
 * /api/v1/auth/passkeys/* to accept either an admin or a member session
 * (see functions/_lib/auth/actor.ts).
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { getJson, patchJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { profile } from "../state";
import { fmt, toast } from "../ui";
import type { NotificationPreferences, Passkey } from "../types";

// getJson uses GET; register/begin is a POST, so call fetch directly
// here to avoid a GET/POST mismatch with the shared client helper.
async function beginRegistration(): Promise<{ options: unknown; challengeToken: string }> {
  const res = await fetch("/api/v1/auth/passkeys/register/begin", { method: "POST", credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as {
    options?: unknown;
    challengeToken?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.options || !body.challengeToken)
    throw new Error(body.error?.message ?? "Could not start passkey enrollment.");
  return body as { options: unknown; challengeToken: string };
}

function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ passkeys: Passkey[] }>("/api/v1/auth/passkeys");
      setPasskeys(data.passkeys);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnroll(e: Event) {
    e.preventDefault();
    setEnrolling(true);
    try {
      const begin = await beginRegistration();
      const credential = await startRegistration({
        optionsJSON: begin.options as PublicKeyCredentialCreationOptionsJSON,
      });
      const res = await fetch("/api/v1/auth/passkeys/register/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: begin.challengeToken,
          response: credential,
          deviceName: deviceName.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Could not add this passkey.");
      toast("Passkey added", "success");
      setDeviceName("");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleRemove(passkey: Passkey) {
    if (!confirm(`Remove passkey "${passkey.deviceName ?? "Unnamed passkey"}"?`)) return;
    try {
      await deleteJson(`/api/v1/auth/passkeys/${passkey.id}`);
      toast("Passkey removed", "success");
      await load();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not remove passkey.", "error");
    }
  }

  if (error) return <ErrorAlert error={error} />;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Passkeys</div>
      <div class="card-body">
        <p class="text-muted small">
          Passkeys let you sign in with Touch ID, Face ID, or a hardware security key instead of a magic link. You can
          register more than one device.
        </p>

        {passkeysSupported ? (
          <form onSubmit={handleEnroll} class="d-flex gap-2 align-items-end flex-wrap mb-3">
            <div>
              <label class="form-label small fw-semibold">Device name (optional)</label>
              <input
                class="form-control form-control-sm"
                value={deviceName}
                onInput={(e) => setDeviceName((e.target as HTMLInputElement).value)}
                placeholder="e.g. Work laptop"
                disabled={enrolling}
              />
            </div>
            <button type="submit" class="btn btn-sm btn-success" disabled={enrolling}>
              {enrolling ? "Waiting for passkey…" : "Add a passkey"}
            </button>
          </form>
        ) : (
          <div class="alert alert-warning small">This browser doesn't support passkeys.</div>
        )}

        {passkeys === null ? (
          <Spinner />
        ) : (
          <table class="table table-sm table-hover mb-0">
            <thead>
              <tr>
                <th>Device</th>
                <th>Last used</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {passkeys.length === 0 ? (
                <tr>
                  <td colspan={4} class="text-center text-muted fst-italic py-3">
                    No passkeys registered
                  </td>
                </tr>
              ) : (
                passkeys.map((p) => (
                  <tr key={p.id}>
                    <td class="fw-semibold">{p.deviceName ?? "Unnamed passkey"}</td>
                    <td class="small">{p.lastUsedAt ? fmt(p.lastUsedAt) : <span class="text-muted">Never</span>}</td>
                    <td class="small">{fmt(p.createdAt)}</td>
                    <td>
                      <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRemove(p)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const PREFERENCE_LABELS: Record<keyof NotificationPreferences, string> = {
  workingGroupUpdates: "Working group updates",
  voteReminders: "Vote reminders",
  generalAnnouncements: "General consortium announcements",
  wgChairMembershipDigest: "Working group roster change digest (chairs & vice-chairs only, weekly)",
};

function NotificationPreferencesCard() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    getJson<NotificationPreferences>("/api/v1/me/notification-preferences")
      .then(setPrefs)
      .catch((e: unknown) => setError(e instanceof ApiClientError ? e.message : "Could not load preferences."));
  }, []);

  async function toggle(key: keyof NotificationPreferences, next: boolean): Promise<void> {
    setSavingKey(key);
    try {
      const updated = await patchJson<NotificationPreferences>("/api/v1/me/notification-preferences", { [key]: next });
      setPrefs(updated);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not update preference.", "error");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Notification preferences</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {!prefs && !error ? (
          <Spinner />
        ) : (
          prefs && (
            <div class="d-flex flex-column gap-2">
              {(Object.keys(PREFERENCE_LABELS) as Array<keyof NotificationPreferences>).map((key) => (
                <div class="form-check form-switch" key={key}>
                  <input
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    id={`portal-notif-${key}`}
                    checked={prefs[key]}
                    disabled={savingKey === key}
                    onChange={(e) => void toggle(key, (e.target as HTMLInputElement).checked)}
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
    <div class="d-flex flex-column gap-3" style="max-width: 720px;">
      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Email</div>
        <div class="card-body">
          <p class="mb-0">{profile.value?.email}</p>
          <p class="text-muted small mb-0">
            Your email address is tied to your membership record. Contact PKI Consortium staff to change it.
          </p>
        </div>
      </div>

      <PasskeysCard />
      <NotificationPreferencesCard />
    </div>
  );
}
