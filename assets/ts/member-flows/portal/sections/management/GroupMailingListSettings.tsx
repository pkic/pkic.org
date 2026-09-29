import type { ComponentChildren } from "preact";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { fmtDate } from "../../ui";
import { useContractForm } from "../../../../hooks/useContractForm";
import { EditActions } from "../../../../ui/EditActions";
import { useState } from "preact/hooks";
import {
  groupMailingListUpdateSchema,
  mailingListResponseSchema,
  type MailingList,
} from "../../../../../shared/schemas/mailing-lists";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { MailingListForm, type MailingListFieldSection } from "../../../../components/mailing-lists/MailingListForm";
import { mailingListDraftToPayload, mailingListToDraft } from "../../../../components/mailing-lists/model";
import { patchValidated } from "../../../../shared/api-client";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";

interface SettingsProps {
  groupId: string;
  list: MailingList;
  onSaved: () => void | Promise<void>;
}

/** Reuse the canonical fields while giving each decision its own edit boundary. */
export function GroupMailingListSettings(props: SettingsProps) {
  return (
    <>
      <SettingsSection
        {...props}
        title="Delivery"
        sections={["identity", "policy"]}
        keys={["email", "label", "postingPolicy", "moderationPolicy"]}
      />
      <SettingsSection
        {...props}
        title="Audience"
        sections={["audience"]}
        keys={["purpose", "subscriptionDefault", "autoSyncCategories"]}
      />
    </>
  );
}

/** The list's standing and dates live together beside the working record. */
export function GroupMailingListStanding(props: SettingsProps) {
  const { list } = props;
  return (
    <SettingsSection {...props} title="Standing" sections={["standing"]} keys={["primaryDiscussion", "active"]} compact>
      <DescriptionList
        density="compact"
        items={[
          { term: "Created", value: fmtDate(list.createdAt) },
          { term: "Updated", value: fmtDate(list.updatedAt) },
          ...(list.archivedAt ? [{ term: "Archived", value: fmtDate(list.archivedAt) }] : []),
        ]}
      />
    </SettingsSection>
  );
}

function SettingsSection({
  groupId,
  list,
  onSaved,
  title,
  sections,
  keys,
  children,
  compact = false,
}: SettingsProps & {
  title: string;
  children?: ComponentChildren;
  compact?: boolean;
  sections: readonly MailingListFieldSection[];
  keys: readonly (keyof ReturnType<typeof mailingListDraftToPayload>)[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => mailingListToDraft(list));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const payload = mailingListDraftToPayload(draft);
  const form = useContractForm(
    groupMailingListUpdateSchema,
    Object.fromEntries(keys.map((key) => [key, payload[key]])),
  );

  function startEditing(): void {
    setDraft(mailingListToDraft(list));
    form.reset();
    setError(null);
    setEditing(true);
  }

  function cancel(): void {
    setDraft(mailingListToDraft(list));
    form.reset();
    setError(null);
    setEditing(false);
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(new Error(checked.message));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(list.id)}`,
        groupMailingListUpdateSchema,
        checked.data,
        mailingListResponseSchema,
      );
      await onSaved();
      setEditing(false);
    } catch (cause) {
      setError(new Error(form.refuse(cause)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel aria-label={title}>
      <form noValidate {...form.handlers} onSubmit={(event) => void save(event)}>
        <PanelHeader title={title} headingLevel={compact ? 3 : 4}>
          <EditActions
            label={`${title} actions`}
            editLabel="Edit"
            editing={editing}
            saving={saving}
            onEdit={startEditing}
            onCancel={cancel}
          />
        </PanelHeader>
        <PanelBody class={compact ? "pk-stack pk-datalist-aligned pk-small" : "pk-stack pk-datalist-aligned"}>
          {error && <ErrorAlert error={error} />}
          <MailingListForm
            sections={sections}
            sectionHeadings={false}
            draft={editing ? draft : mailingListToDraft(list)}
            readOnly={!editing}
            fields={form.of}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            idPrefix={`group-mailing-list-${list.id}-${sections[0]}`}
          />
          {children}
        </PanelBody>
      </form>
    </Panel>
  );
}
