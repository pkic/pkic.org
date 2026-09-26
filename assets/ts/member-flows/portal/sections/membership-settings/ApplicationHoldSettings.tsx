/**
 * Application workflow — the deadlines a membership application is reviewed
 * against, and the addresses each stage notifies.
 *
 * One of the three subjects that used to share a single "Membership Settings"
 * tab (#40). They were three panels on one screen, so none of them could be
 * linked to, and the address bar said only that the reader was somewhere in
 * settings. Each is a page now, and each loads only the data it shows.
 */
import { useState } from "preact/hooks";
import {
  MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH,
  MEMBERSHIP_WINDOW_DAY_LIMITS,
  membershipSettingsSchema,
  membershipSettingsUpdateSchema,
  type MembershipSettings,
} from "../../../../../shared/schemas/membership-settings";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { EditActions } from "../../../../ui/EditActions";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { getJson, patchJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

const SETTINGS_API = "/api/v1/membership/settings";

/** The three review deadlines, each bounded by the shared settings schema. */
const WINDOW_FIELDS: ReadonlyArray<{ key: keyof typeof MEMBERSHIP_WINDOW_DAY_LIMITS; label: string }> = [
  { key: "onHoldResponseDeadlineDays", label: "On-hold response deadline (days)" },
];

type RecipientKey = "ccApplicantEmails";

const RECIPIENT_FIELDS: ReadonlyArray<{ key: RecipientKey; label: string }> = [
  { key: "ccApplicantEmails", label: "CC on applicant emails" },
];

function WorkflowForm({ initial, canWrite }: { initial: MembershipSettings; canWrite: boolean }) {
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(membershipSettingsUpdateSchema, {
    expectedRevision: saved.revision,
    onHoldResponseDeadlineDays: settings.onHoldResponseDeadlineDays,
    ccApplicantEmails: settings.ccApplicantEmails,
    autoReminderOnHolds: settings.autoReminderOnHolds,
  });
  function reset() {
    setSettings(saved);
    setError("");
    form.reset();
  }

  const [saving, setSaving] = useState(false);

  async function save(event: Event) {
    event.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const updated = await patchJson(SETTINGS_API, checked.data, membershipSettingsSchema);
      setSettings(updated);
      setSaved(updated);
      setEditing(false);
      toast("Membership workflow settings saved", "success");
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate {...form.handlers} onSubmit={save} autocomplete="off">
      <Panel>
        <PanelHeader title="On-hold reminders">
          {canWrite && (
            <EditActions
              label="Workflow settings actions"
              editing={editing}
              saving={saving}
              saveLabel="Save workflow settings"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        {/* The page header above already names the subject, so the panel that
            holds the whole form carries no title of its own. */}
        <PanelBody class="pk-stack">
          {editing ? (
            <>
              <h3>Review deadlines</h3>
              <div class="pk-grid pk-grid--tight">
                {WINDOW_FIELDS.map(({ key, label }) => {
                  const limit = MEMBERSHIP_WINDOW_DAY_LIMITS[key];
                  return (
                    <Field
                      key={key}
                      {...form.of(key)}
                      label={label}
                      help={`Between ${String(limit.min)} and ${String(limit.max)} days.`}
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          name={key}
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
              <h3>Notifications</h3>
              {RECIPIENT_FIELDS.map(({ key, label }) => (
                <Field
                  key={key}
                  {...form.of(key)}
                  label={label}
                  help="One or more email addresses, separated by commas."
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name={key}
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
              <Checkbox
                name="autoReminderOnHolds"
                checked={settings.autoReminderOnHolds}
                disabled={!canWrite || saving}
                onChange={(inputEvent) =>
                  setSettings({ ...settings, autoReminderOnHolds: (inputEvent.target as HTMLInputElement).checked })
                }
                label="Send automatic reminders three days before an on-hold deadline"
              />
            </>
          ) : (
            <div class="pk-split">
              <section class="pk-stack pk-stack--snug">
                <h3>Review deadlines</h3>
                <DescriptionList items={WINDOW_FIELDS.map(({ key, label }) => ({ term: label, value: saved[key] }))} />
              </section>
              <section class="pk-stack pk-stack--snug">
                <h3>Notifications</h3>
                <DescriptionList
                  items={[
                    ...RECIPIENT_FIELDS.map(({ key, label }) => ({ term: label, value: saved[key] })),
                    {
                      term: "Automatic reminders",
                      value: saved.autoReminderOnHolds ? "Three days before the on-hold deadline" : "Disabled",
                    },
                  ]}
                />
              </section>
            </div>
          )}
          <ErrorAlert error={error} />
        </PanelBody>
      </Panel>
    </form>
  );
}

export function ApplicationHoldSettings({ canWrite }: { canWrite: boolean }) {
  const state = useData(() => getJson(SETTINGS_API, membershipSettingsSchema), []);

  return (
    <div class="pk pk-stack">
      <PageHeader title="Applicant reminders" />
      {state.loading ? (
        <Spinner label="Loading the application workflow…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : state.data ? (
        <WorkflowForm initial={state.data} canWrite={canWrite} />
      ) : null}
    </div>
  );
}
