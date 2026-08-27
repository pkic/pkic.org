import { useCallback, useEffect, useState } from "preact/hooks";
import {
  MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH,
  MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH,
  membershipCategoryCatalogResponseSchema,
  membershipCategoryResponseSchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../shared/schemas/membership-categories";
import {
  MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH,
  MEMBERSHIP_WINDOW_DAY_LIMITS,
  membershipSettingsSchema,
  type MembershipSettings,
} from "../../../../shared/schemas/membership-settings";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { getJson, patchJson } from "../../../shared/api-client";
import { toast } from "../ui";

const SETTINGS_API = "/api/v1/system/membership-settings";
const CATEGORIES_API = "/api/v1/system/membership-categories";

function MembershipSettingsForm({ initial, canWrite }: { initial: MembershipSettings; canWrite: boolean }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await patchJson(
        SETTINGS_API,
        {
          expectedRevision: settings.revision,
          consultationWindowDays: settings.consultationWindowDays,
          ecReviewWindowDays: settings.ecReviewWindowDays,
          onHoldResponseDeadlineDays: settings.onHoldResponseDeadlineDays,
          consultationEmailRecipients: settings.consultationEmailRecipients,
          ecEmailRecipients: settings.ecEmailRecipients,
          ccApplicantEmails: settings.ccApplicantEmails,
          autoReminderOnHolds: settings.autoReminderOnHolds,
        },
        membershipSettingsSchema,
      );
      setSettings(updated);
      toast("Membership workflow settings saved", "success");
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} class="card border-0 shadow-sm mb-4" autocomplete="off">
      <div class="card-body">
        <h5 class="card-title">Application workflow</h5>
        <p class="small text-muted">Configure review deadlines and operational notification recipients.</p>
        <div class="row g-3">
          {[
            ["consultation-window-days", "Consultation window (days)", "consultationWindowDays"],
            ["ec-review-window-days", "Executive Council review window (days)", "ecReviewWindowDays"],
            ["on-hold-deadline-days", "On-hold response deadline (days)", "onHoldResponseDeadlineDays"],
          ].map(([id, label, key]) => {
            const limit = MEMBERSHIP_WINDOW_DAY_LIMITS[key as keyof typeof MEMBERSHIP_WINDOW_DAY_LIMITS];
            return (
              <div class="col-lg-4" key={String(key)}>
                <label class="form-label" for={String(id)}>
                  {label}
                </label>
                <input
                  id={String(id)}
                  type="number"
                  min={limit.min}
                  max={limit.max}
                  class="form-control"
                  value={settings[key as keyof MembershipSettings] as number}
                  disabled={!canWrite || saving}
                  onInput={(inputEvent) =>
                    setSettings({
                      ...settings,
                      [key as string]: Number((inputEvent.target as HTMLInputElement).value),
                    })
                  }
                />
              </div>
            );
          })}
          {[
            ["consultation-recipients", "Consultation email recipients", "consultationEmailRecipients"],
            ["ec-recipients", "Executive Council email recipients", "ecEmailRecipients"],
            ["applicant-email-cc", "CC on applicant emails", "ccApplicantEmails"],
          ].map(([id, label, key]) => (
            <div class="col-12" key={key}>
              <label class="form-label" for={id}>
                {label}
              </label>
              <input
                id={id}
                class="form-control"
                maxlength={MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH}
                value={settings[key as keyof MembershipSettings] as string}
                disabled={!canWrite || saving}
                onInput={(inputEvent) =>
                  setSettings({ ...settings, [key]: (inputEvent.target as HTMLInputElement).value })
                }
              />
            </div>
          ))}
          <div class="col-12">
            <div class="form-check">
              <input
                id="auto-reminder-on-holds"
                class="form-check-input"
                type="checkbox"
                checked={settings.autoReminderOnHolds}
                disabled={!canWrite || saving}
                onChange={(inputEvent) =>
                  setSettings({
                    ...settings,
                    autoReminderOnHolds: (inputEvent.target as HTMLInputElement).checked,
                  })
                }
              />
              <label class="form-check-label" for="auto-reminder-on-holds">
                Send automatic reminders three days before an on-hold deadline
              </label>
            </div>
          </div>
        </div>
        {canWrite && (
          <button type="submit" class="btn btn-primary btn-sm mt-3" disabled={saving}>
            {saving ? "Saving…" : "Save workflow settings"}
          </button>
        )}
      </div>
    </form>
  );
}

function MembershipCategoryEditor({
  category,
  canWrite,
  onSaved,
}: {
  category: MembershipCategoryCatalogEntry;
  canWrite: boolean;
  onSaved: (category: MembershipCategoryCatalogEntry) => void;
}) {
  const [draft, setDraft] = useState(category);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(category), [category]);

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await patchJson(
        `${CATEGORIES_API}/${encodeURIComponent(category.code)}`,
        {
          expectedRevision: draft.revision,
          label: draft.label,
          description: draft.description,
          displayOrder: draft.displayOrder,
          isVoting: draft.isVoting,
        },
        membershipCategoryResponseSchema,
      );
      setDraft(response.category);
      onSaved(response.category);
      toast(`Category ${category.code} saved`, "success");
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const fieldPrefix = `membership-category-${category.code.toLowerCase()}`;
  return (
    <form onSubmit={save} class="card border-0 shadow-sm" autocomplete="off">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          <h6 class="mb-0">Category {category.code}</h6>
          <span class="badge text-bg-secondary">{category.isIndividual ? "Individual" : "Organization"}</span>
          <span class={`badge ${draft.isVoting ? "text-bg-success" : "text-bg-light"}`}>
            {draft.isVoting ? "Voting" : "Non-voting"}
          </span>
        </div>
        <div class="row g-3">
          <div class="col-lg-8">
            <label class="form-label" for={`${fieldPrefix}-label`}>
              Label
            </label>
            <input
              id={`${fieldPrefix}-label`}
              class="form-control"
              maxlength={MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH}
              value={draft.label}
              disabled={!canWrite || saving}
              onInput={(event) => setDraft({ ...draft, label: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-lg-4">
            <label class="form-label" for={`${fieldPrefix}-order`}>
              Display order
            </label>
            <input
              id={`${fieldPrefix}-order`}
              type="number"
              min={0}
              class="form-control"
              value={draft.displayOrder}
              disabled={!canWrite || saving}
              onInput={(event) =>
                setDraft({ ...draft, displayOrder: Number((event.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div class="col-12">
            <label class="form-label" for={`${fieldPrefix}-description`}>
              Description
            </label>
            <textarea
              id={`${fieldPrefix}-description`}
              class="form-control"
              rows={2}
              maxlength={MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH}
              value={draft.description ?? ""}
              disabled={!canWrite || saving}
              onInput={(event) => {
                const value = (event.target as HTMLTextAreaElement).value;
                setDraft({ ...draft, description: value || null });
              }}
            />
          </div>
          <div class="col-12">
            <div class="form-check">
              <input
                id={`${fieldPrefix}-voting`}
                class="form-check-input"
                type="checkbox"
                checked={draft.isVoting}
                disabled={!canWrite || saving}
                onChange={(event) => setDraft({ ...draft, isVoting: (event.target as HTMLInputElement).checked })}
              />
              <label class="form-check-label" for={`${fieldPrefix}-voting`}>
                This category has consortium and group voting rights
              </label>
            </div>
          </div>
        </div>
        {canWrite && (
          <button type="submit" class="btn btn-outline-primary btn-sm mt-3" disabled={saving}>
            {saving ? "Saving…" : `Save category ${category.code}`}
          </button>
        )}
      </div>
    </form>
  );
}

export function MembershipConfiguration({ canWrite }: { canWrite: boolean }) {
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [categories, setCategories] = useState<MembershipCategoryCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedSettings, loadedCategories] = await Promise.all([
        getJson(SETTINGS_API, membershipSettingsSchema),
        getJson(CATEGORIES_API, membershipCategoryCatalogResponseSchema),
      ]);
      setSettings(loadedSettings);
      setCategories(loadedCategories.categories);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <div>
      <MembershipSettingsForm initial={settings} canWrite={canWrite} />
      <div class="mb-3">
        <h5>Membership categories</h5>
        <p class="small text-muted mb-1">
          Category codes and organization/individual classification are structural and cannot be changed here.
        </p>
        <p class="small text-warning mb-0">
          Voting-right changes take effect immediately for consultation concerns and open ballots.
        </p>
      </div>
      <div class="d-grid gap-3">
        {categories.map((category) => (
          <MembershipCategoryEditor
            key={category.code}
            category={category}
            canWrite={canWrite}
            onSaved={(updated) =>
              setCategories((current) =>
                current
                  .map((entry) => (entry.code === updated.code ? updated : entry))
                  .sort((left, right) => left.displayOrder - right.displayOrder || left.code.localeCompare(right.code)),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
