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
import {
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateSchema,
  type MembershipApplicationPolicyField,
} from "../../../../shared/schemas/membership-application-form";
import type { FormDefinitionUpdateInput } from "../../../../shared/schemas/forms";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Badge as StatusBadge } from "../../../components/Badge";
import { Spinner } from "../../../components/Spinner";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../components/forms/FormDefinitionEditor";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Textarea, TextInput } from "../../../ui/TextControl";
import { getJson, patchJson } from "../../../shared/api-client";
import { toast } from "../ui";

const SETTINGS_API = "/api/v1/membership/settings";
const CATEGORIES_API = "/api/v1/membership/categories";
const APPLICATION_FORM_DEFINITION_API = "/api/v1/members/applications/form/definition";

/** The three review deadlines, each bounded by the shared settings schema. */
const WINDOW_FIELDS: ReadonlyArray<{ key: keyof typeof MEMBERSHIP_WINDOW_DAY_LIMITS; label: string }> = [
  { key: "consultationWindowDays", label: "Consultation window (days)" },
  { key: "ecReviewWindowDays", label: "EC review window (days)" },
  { key: "onHoldResponseDeadlineDays", label: "On-hold response deadline (days)" },
];

type RecipientKey = "consultationEmailRecipients" | "ecEmailRecipients" | "ccApplicantEmails";

const RECIPIENT_FIELDS: ReadonlyArray<{ key: RecipientKey; label: string }> = [
  { key: "consultationEmailRecipients", label: "Consultation email recipients" },
  { key: "ecEmailRecipients", label: "Executive Council email recipients" },
  { key: "ccApplicantEmails", label: "CC on applicant emails" },
];

function MembershipApplicationFormEditor({ canWrite }: { canWrite: boolean }) {
  const [detail, setDetail] = useState<EditableFormDetail | null>(null);
  const [policyFields, setPolicyFields] = useState<MembershipApplicationPolicyField[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(
        APPLICATION_FORM_DEFINITION_API,
        membershipApplicationFormDefinitionResponseSchema,
      );
      setDetail({ form: response.form, fields: response.fields });
      setPolicyFields(response.policyFields);
      setUpdatedAt(response.form.updatedAt);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function save(payload: FormDefinitionUpdateInput): Promise<string> {
    if (!detail || !updatedAt) throw new Error("The membership application form is unavailable.");
    const input = membershipApplicationFormDefinitionUpdateSchema.parse({ ...payload, expectedUpdatedAt: updatedAt });
    const response = await patchJson(
      APPLICATION_FORM_DEFINITION_API,
      input,
      membershipApplicationFormDefinitionResponseSchema,
    );
    setDetail({ form: response.form, fields: response.fields });
    setPolicyFields(response.policyFields);
    setUpdatedAt(response.form.updatedAt);
    toast("Membership application form saved", "success");
    return response.form.key;
  }

  return (
    <Panel aria-label="Membership application form">
      <PanelHeader title="Membership application form" />
      <PanelBody class="pk-stack">
        <p class="pk-small">
          Configure the additional questions shown after email verification and category selection. Identity,
          organization, category, and required policy fields remain owned by the membership workflow.
        </p>
        {loading ? (
          <Spinner label="Loading the membership application form…" />
        ) : error ? (
          <ErrorAlert error={error} />
        ) : detail ? (
          <>
            <div class="pk-stack pk-stack--snug">
              <h4>Required policy acknowledgements</h4>
              <p class="pk-small">These workflow-owned consent fields are mandatory and cannot be changed here.</p>
              <ul class="pk-stack pk-stack--tight" aria-label="Required policy acknowledgements">
                {policyFields.map((field) => (
                  <li class="pk-cluster pk-cluster--start" key={field.key}>
                    <span>{field.label}</span>
                    <Badge tone="info">Required</Badge>
                  </li>
                ))}
              </ul>
            </div>
            {canWrite ? (
              <FormDefinitionEditor
                mode="edit"
                detail={detail}
                purposes={["application"]}
                onSave={(payload) => save(payload as FormDefinitionUpdateInput)}
                onSaved={() => undefined}
                onCancel={() => void load()}
                onError={(message) => toast(message, "error")}
              />
            ) : (
              <div class="pk-stack pk-stack--snug">
                <div class="pk-cluster">
                  <strong>{detail.form.title}</strong>
                  <StatusBadge status={detail.form.status} />
                </div>
                {detail.form.description && <p class="pk-small">{detail.form.description}</p>}
                <ul class="pk-stack pk-stack--tight" aria-label="Membership application form fields">
                  {detail.fields.map((field) => (
                    <li class="pk-cluster pk-cluster--start" key={field.key}>
                      <span>
                        {field.label} <span class="pk-muted">({field.fieldType})</span>
                      </span>
                      {field.required && <Badge tone="info">Required</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

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
    <form onSubmit={save} autocomplete="off">
      <Panel>
        <PanelHeader title="Application workflow" />
        <PanelBody class="pk-stack">
          <p class="pk-small">Configure review deadlines and operational notification recipients.</p>
          <div class="pk-grid pk-grid--tight">
            {WINDOW_FIELDS.map(({ key, label }) => {
              const limit = MEMBERSHIP_WINDOW_DAY_LIMITS[key];
              return (
                <Field key={key} label={label} help={`Between ${String(limit.min)} and ${String(limit.max)} days.`}>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      min={limit.min}
                      max={limit.max}
                      value={settings[key]}
                      disabled={!canWrite || saving}
                      onInput={(inputEvent) =>
                        setSettings({ ...settings, [key]: Number((inputEvent.target as HTMLInputElement).value) })
                      }
                    />
                  )}
                </Field>
              );
            })}
          </div>
          {RECIPIENT_FIELDS.map(({ key, label }) => (
            <Field key={key} label={label} help="One or more email addresses, separated by commas.">
              {(control) => (
                <TextInput
                  {...control}
                  maxlength={MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH}
                  value={settings[key]}
                  disabled={!canWrite || saving}
                  onInput={(inputEvent) =>
                    setSettings({ ...settings, [key]: (inputEvent.target as HTMLInputElement).value })
                  }
                />
              )}
            </Field>
          ))}
          <label class="pk-check">
            <input
              class="pk-check__input"
              type="checkbox"
              checked={settings.autoReminderOnHolds}
              disabled={!canWrite || saving}
              onChange={(inputEvent) =>
                setSettings({ ...settings, autoReminderOnHolds: (inputEvent.target as HTMLInputElement).checked })
              }
            />
            <span class="pk-check__label">Send automatic reminders three days before an on-hold deadline</span>
          </label>
          {canWrite && (
            <div class="pk-cluster">
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                {saving ? "Saving…" : "Save workflow settings"}
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>
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

  return (
    <form onSubmit={save} autocomplete="off">
      <Panel>
        <PanelHeader title={`Category ${category.code}`} headingLevel={4}>
          <Badge tone="neutral">{category.isIndividual ? "Individual" : "Organization"}</Badge>
          <Badge tone={draft.isVoting ? "ok" : "neutral"}>{draft.isVoting ? "Voting" : "Non-voting"}</Badge>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <div class="pk-grid">
            <Field label="Label">
              {(control) => (
                <TextInput
                  {...control}
                  maxlength={MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH}
                  value={draft.label}
                  disabled={!canWrite || saving}
                  onInput={(event) => setDraft({ ...draft, label: (event.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Display order">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  min={0}
                  value={draft.displayOrder}
                  disabled={!canWrite || saving}
                  onInput={(event) =>
                    setDraft({ ...draft, displayOrder: Number((event.target as HTMLInputElement).value) })
                  }
                />
              )}
            </Field>
          </div>
          <Field label="Description">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxlength={MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH}
                value={draft.description ?? ""}
                disabled={!canWrite || saving}
                onInput={(event) => {
                  const value = (event.target as HTMLTextAreaElement).value;
                  setDraft({ ...draft, description: value || null });
                }}
              />
            )}
          </Field>
          <label class="pk-check">
            <input
              class="pk-check__input"
              type="checkbox"
              checked={draft.isVoting}
              disabled={!canWrite || saving}
              onChange={(event) => setDraft({ ...draft, isVoting: (event.target as HTMLInputElement).checked })}
            />
            <span class="pk-check__label">This category has consortium and group voting rights</span>
          </label>
          {canWrite && (
            <div class="pk-cluster">
              <Button type="submit" size="sm" loading={saving}>
                {saving ? "Saving…" : `Save category ${category.code}`}
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>
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

  if (loading) return <Spinner label="Loading membership configuration…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <div class="pk pk-stack">
      <MembershipSettingsForm initial={settings} canWrite={canWrite} />
      <MembershipApplicationFormEditor canWrite={canWrite} />
      <div class="pk-stack pk-stack--tight">
        <h3>Membership categories</h3>
        <p class="pk-small">
          Category codes and organization/individual classification are structural and cannot be changed here.
        </p>
        <p class="pk-warning-note">
          Caution: voting-right changes take effect immediately for consultation concerns and open ballots.
        </p>
      </div>
      <div class="pk-stack">
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
