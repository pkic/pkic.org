/**
 * Membership → Settings. A plain form over the singleton
 * membership_settings row.
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast } from "../ui";
import type { AdminMembershipSettings } from "../types";

export function MembershipSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AdminMembershipSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminMembershipSettings>("/api/v1/admin/membership-settings");
      setSettings(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: Event) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api<AdminMembershipSettings>("/api/v1/admin/membership-settings", {
        method: "PATCH",
        body: JSON.stringify({
          consultationWindowDays: settings.consultationWindowDays,
          ecReviewWindowDays: settings.ecReviewWindowDays,
          onHoldResponseDeadlineDays: settings.onHoldResponseDeadlineDays,
          consultationEmailRecipients: settings.consultationEmailRecipients,
          ecEmailRecipients: settings.ecEmailRecipients,
          ccApplicantEmails: settings.ccApplicantEmails,
          autoReminderOnHolds: settings.autoReminderOnHolds,
          forumVoteMinEndorsers: settings.forumVoteMinEndorsers,
        }),
      });
      setSettings(updated);
      toast("Settings saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <form onSubmit={save} class="card border-0 shadow-sm adm-settings-card">
      <div class="card-body">
        <div class="row g-3">
          <div class="col-sm-6">
            <label class="form-label small fw-semibold">Consultation window (days)</label>
            <input
              type="number"
              min={1}
              class="form-control form-control-sm"
              value={settings.consultationWindowDays}
              onInput={(e) =>
                setSettings({ ...settings, consultationWindowDays: Number((e.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label small fw-semibold">EC review window (days)</label>
            <input
              type="number"
              min={1}
              class="form-control form-control-sm"
              value={settings.ecReviewWindowDays}
              onInput={(e) =>
                setSettings({ ...settings, ecReviewWindowDays: Number((e.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label small fw-semibold">On-hold response deadline (days)</label>
            <input
              type="number"
              min={1}
              class="form-control form-control-sm"
              value={settings.onHoldResponseDeadlineDays}
              onInput={(e) =>
                setSettings({ ...settings, onHoldResponseDeadlineDays: Number((e.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label small fw-semibold">Forum vote min endorsers</label>
            <input
              type="number"
              min={0}
              class="form-control form-control-sm"
              value={settings.forumVoteMinEndorsers}
              onInput={(e) =>
                setSettings({ ...settings, forumVoteMinEndorsers: Number((e.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div class="col-12">
            <label class="form-label small fw-semibold">Consultation email recipients</label>
            <input
              class="form-control form-control-sm"
              value={settings.consultationEmailRecipients}
              onInput={(e) =>
                setSettings({ ...settings, consultationEmailRecipients: (e.target as HTMLInputElement).value })
              }
            />
          </div>
          <div class="col-12">
            <label class="form-label small fw-semibold">EC email recipients</label>
            <input
              class="form-control form-control-sm"
              value={settings.ecEmailRecipients}
              onInput={(e) => setSettings({ ...settings, ecEmailRecipients: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-12">
            <label class="form-label small fw-semibold">CC on all applicant emails</label>
            <input
              class="form-control form-control-sm"
              value={settings.ccApplicantEmails}
              onInput={(e) => setSettings({ ...settings, ccApplicantEmails: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-12">
            <div class="form-check">
              <input
                class="form-check-input"
                type="checkbox"
                id="auto-reminder-on-holds"
                checked={settings.autoReminderOnHolds}
                onChange={(e) =>
                  setSettings({ ...settings, autoReminderOnHolds: (e.target as HTMLInputElement).checked })
                }
              />
              <label class="form-check-label small" for="auto-reminder-on-holds">
                Auto-reminder on holds (3 days before deadline)
              </label>
            </div>
          </div>
        </div>
        <div class="mt-3">
          <button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
