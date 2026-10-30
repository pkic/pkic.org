/**
 * What an organization contact may change about their organization's public
 * content, and what the page says while a change is waiting on review.
 *
 * This is a submission, not an edit: nothing here writes the organization's
 * profile directly. A contact proposes a change, staff accept or refuse it,
 * and until they do the form is replaced by the pending submission and the
 * option to withdraw it — which is why the banner and the form live together
 * rather than beside each other on the page.
 *
 * It left `MyOrganization.tsx` because that file is the organization's whole
 * page — logo, governance, representatives, sponsorship, submission history —
 * and reviewing content is one responsibility among those rather than part of
 * the page's own work.
 */
import { MarkdownEditor } from "../../../components/markdown-editor/MarkdownInput";
import { useMemo, useState } from "preact/hooks";
import { ApiClientError, deleteJson, postJson } from "../../../shared/api-client";
import { confirmAction } from "../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Markdown } from "../../../ui/Markdown";
import { EditActions } from "../../../ui/EditActions";
import { useContractForm } from "../../../hooks/useContractForm";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";
import { toast, fmt } from "../ui";
import type { MyOrganizationProfile, MyOrganizationReview } from "../types";
import { ProfileLinksInput } from "../../../components/ProfileLinksInput";
import { ProposedChanges } from "./OrganizationProposedChanges";
import {
  ORGANIZATION_CONTENT_FIELD_LABELS,
  ORGANIZATION_CONTENT_MARKDOWN_HELP,
  ORGANIZATION_URL_FIELD_ORDER,
  organizationPath,
} from "../../../shared/organization-content";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import {
  organizationContentReviewCreateSchema,
  organizationContentReviewCreateResponseSchema,
} from "../../../../shared/schemas/organization-self-service";

function PendingReviewBanner({
  review,
  organizationId,
  onWithdrawn,
}: {
  review: MyOrganizationReview;
  organizationId: string;
  onWithdrawn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function withdraw(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Withdraw this pending submission?",
      body: `Submitted ${fmt(review.submittedAt)}, still awaiting staff review.`,
      consequences: ["The proposed changes are discarded", "You can submit new changes at any time"],
      confirmLabel: "Withdraw submission",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteJson(
        `${organizationPath(organizationId)}/content/reviews/${encodeURIComponent(review.id)}`,
        successResponseSchema,
      );
      toast("Submission withdrawn", "success");
      await onWithdrawn();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert tone="info" title={`A content change is pending staff review — submitted ${fmt(review.submittedAt)}.`}>
      <div class="pk-stack pk-stack--snug">
        <ProposedChanges review={review} />
        <div class="pk-cluster">
          <Button variant="secondary" loading={busy} onClick={() => void withdraw()}>
            {busy ? "Withdrawing…" : "Withdraw submission"}
          </Button>
        </div>
      </div>
    </Alert>
  );
}

type EditableField = (typeof ORGANIZATION_URL_FIELD_ORDER)[number] | "slogan" | "description" | "contentMarkdown";

function ContentEditForm({
  organizationId,
  org,
  reload,
  onCancel,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
  onCancel: () => void;
}) {
  const initial = useMemo<Record<EditableField, string>>(
    () => ({
      slogan: org.slogan ?? "",
      description: org.description ?? "",
      contentMarkdown: org.contentMarkdown ?? "",
      website: org.website ?? "",
      blogUrl: org.blogUrl ?? "",
      blogFeedUrl: org.blogFeedUrl ?? "",
      pressUrl: org.pressUrl ?? "",
      pressFeedUrl: org.pressFeedUrl ?? "",
      careersUrl: org.careersUrl ?? "",
    }),
    [org],
  );
  const initialLinks = useMemo(() => [...org.links], [org]);
  const [form, setForm] = useState(initial);
  const [links, setLinks] = useState<string[]>(initialLinks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: EditableField, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const changes: Record<string, string | string[] | null> = {};
  for (const key of Object.keys(initial) as EditableField[]) {
    const next = form[key].trim();
    const prev = initial[key].trim();
    if (next !== prev) changes[key] = next === "" ? null : next;
  }
  if (links.join("\n") !== initialLinks.join("\n")) {
    changes.links = links;
  }
  const validation = useContractForm(organizationContentReviewCreateSchema, changes);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    const checked = validation.submit();
    if (!checked.data) return setError(checked.formMessage);
    if (Object.keys(changes).length === 0) {
      setError("No changes to submit.");
      return;
    }

    setSaving(true);
    try {
      await postJson(
        `${organizationPath(organizationId)}/content/reviews`,
        checked.data,
        organizationContentReviewCreateResponseSchema,
      );
      toast("Submitted for staff review", "success");
      await reload();
    } catch (err) {
      setError(validation.refuse(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate {...validation.handlers} onSubmit={(e) => void handleSubmit(e)} class="pk-stack">
      <p class="pk-muted pk-small">
        Changes are queued for staff review — your organization's public page won't update until they're approved.
      </p>
      <Field label="Slogan" {...validation.of("slogan")}>
        {(control) => (
          <TextInput
            {...control}
            name="slogan"
            value={form.slogan}
            onInput={(e) => setField("slogan", (e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        )}
      </Field>
      <Field label="Description" {...validation.of("description")}>
        {(control) => (
          <MarkdownEditor
            variant="compact"
            {...control}
            name="description"
            label="Description"
            initialValue={form.description}
            onChange={(value) => setField("description", value)}
            disabled={saving}
          />
        )}
      </Field>
      <Field
        label="Long-form content (Markdown)"
        help={ORGANIZATION_CONTENT_MARKDOWN_HELP}
        {...validation.of("contentMarkdown")}
      >
        {(control) => (
          <MarkdownEditor
            {...control}
            name="contentMarkdown"
            label="Long-form content (Markdown)"
            initialValue={form.contentMarkdown}
            onChange={(value) => setField("contentMarkdown", value)}
            disabled={saving}
          />
        )}
      </Field>
      <div class="pk-grid">
        {ORGANIZATION_URL_FIELD_ORDER.map((key) => (
          <Field key={key} label={ORGANIZATION_CONTENT_FIELD_LABELS[key]} {...validation.of(key)}>
            {(control) => (
              <TextInput
                {...control}
                type="url"
                placeholder="https://…"
                name={key}
                value={form[key]}
                onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
                disabled={saving}
              />
            )}
          </Field>
        ))}
      </div>
      <ProfileLinksInput
        fieldName="links"
        label="Profile links"
        value={links}
        inputAriaLabel="Organization profile link URL"
        onChange={setLinks}
      />

      {error && <ErrorAlert error={error} />}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Submitting…" : "Submit for review"}
        </Button>
        <Button disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ContentEditorCard({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Panel aria-label="Member page content">
      <PanelHeader title="Member page content">
        {!editing && !org.pendingReview && (
          <EditActions
            label="Member page content actions"
            editing={false}
            saving={false}
            onEdit={() => setEditing(true)}
            onCancel={() => setEditing(false)}
          />
        )}
      </PanelHeader>
      <PanelBody>
        {org.pendingReview ? (
          <PendingReviewBanner review={org.pendingReview} organizationId={organizationId} onWithdrawn={reload} />
        ) : editing ? (
          <ContentEditForm
            key={organizationId}
            organizationId={organizationId}
            org={org}
            reload={async () => {
              await reload();
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : org.contentMarkdown ? (
          <Markdown markdown={org.contentMarkdown} />
        ) : (
          <p class="pk-muted">No member page content yet.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
