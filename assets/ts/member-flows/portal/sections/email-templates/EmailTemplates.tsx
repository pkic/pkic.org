import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";
import { useState, useEffect, useRef } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import type { MenuItem } from "../../../../ui/Menu";
import { RowActions } from "../../../../ui/RowActions";
import { useContractForm, type FieldPresentation } from "../../../../hooks/useContractForm";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { deleteJson, getJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import type { EmailTemplateSummary, EmailTemplateVersion } from "../../../../../shared/schemas/email-templates";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  emailTemplateCreateSchema,
  emailTemplatesListResponseSchema,
  emailTemplateExistsResponseSchema,
  emailTemplateVersionCreateResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../../../../shared/schemas/email-templates";
import { EMAIL_CONTENT_TYPE_OPTIONS, EMAIL_MESSAGE_TYPE_OPTIONS } from "../../../../shared/email-type-options";
import { TemplateEditor } from "./EmailTemplateEditor";
import { EMAIL_TEMPLATES_API, getEmailTemplateEditorVersion } from "../../../../shared/email-template-catalog";

// The key, the subject and the body are code, so they are set in `pk-mono`.
// Content.css rides a lazy chunk rather than the entry stylesheet, so the
// module that writes the class has to import it or the text renders in the
// body face.
import "../../../../ui/Content.css";

// ────────────────────────────────────────────────────────
// Create new template
// ────────────────────────────────────────────────────────

function CreateTemplate({
  canRead,
  onCreated,
  onCancel,
  showCancel = true,
}: {
  canRead: boolean;
  onCreated: (key: string) => void;
  onCancel: () => void;
  showCancel?: boolean;
}) {
  const [key, setKey] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<EmailContentType>("markdown");
  const [messageType, setMessageType] = useState<EmailMessageType>("transactional");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyCheckStatus, setKeyCheckStatus] = useState<"idle" | "checking" | "exists" | "available">("idle");
  // One basis for validation: the create contract — the key the route reads
  // from its path and the version it reads from the body — decides what each
  // field shows as it is typed and what Create may send.
  const form = useContractForm(emailTemplateCreateSchema, {
    key,
    content: body,
    subjectTemplate: subject.trim() ? subject : undefined,
    contentType,
    messageType,
  });

  useEffect(() => {
    if (!canRead) {
      setKeyCheckStatus("idle");
      return;
    }
    // Only a key the contract accepts is worth asking the catalog about.
    if (!emailTemplateCreateSchema.shape.key.safeParse(key).success) {
      setKeyCheckStatus("idle");
      return;
    }
    setKeyCheckStatus("checking");
    const timer = setTimeout(() => {
      getJson(`${EMAIL_TEMPLATES_API}/${encodeURIComponent(key)}/exists`, emailTemplateExistsResponseSchema)
        .then((data) => setKeyCheckStatus(data.exists ? "exists" : "available"))
        .catch(() => setKeyCheckStatus("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [key]);

  // The catalog's verdict on the key sits beside the contract's. A key the
  // contract refuses is refused first; otherwise a key the catalog already
  // holds is refused by the catalog, and a free one is said to be free —
  // as a state with a mark, not a green border, and only the blocking one
  // sets aria-invalid.
  const keyContract = form.of("key");
  const keyField: FieldPresentation =
    keyContract.state === "invalid"
      ? keyContract
      : keyCheckStatus === "exists"
        ? { state: "invalid", message: "A template with this key already exists" }
        : keyCheckStatus === "available"
          ? { state: "ok", message: "Key is available" }
          : keyContract;

  async function doCreate(event: Event) {
    event.preventDefault();
    if (keyCheckStatus === "checking") {
      toast("Still checking key availability, please wait", "error");
      return;
    }
    if (keyCheckStatus === "exists") return;
    setError("");
    // Nothing is sent until the contract accepts the whole draft.
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      const { key: templateKey, ...version } = checked.data;
      await postJson(
        `${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions`,
        version,
        emailTemplateVersionCreateResponseSchema,
      );
      toast(`Template "${templateKey}" created as draft v1`, "success");
      onCreated(templateKey);
    } catch (e) {
      // A server refusal names its fields the same way the contract does.
      const message = form.refuse(e);
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-container pk-container--narrow">
      <Panel>
        <PanelHeader title="Create New Template">
          {showCancel && (
            <Button size="sm" onClick={onCancel}>
              ← Back to list
            </Button>
          )}
        </PanelHeader>
        <PanelBody>
          <form noValidate class="pk-stack" {...form.handlers} onSubmit={(event) => void doCreate(event)}>
            <Field
              label="Template key"
              required
              {...keyField}
              help={
                keyCheckStatus === "checking"
                  ? "Checking availability…"
                  : "A unique identifier for this template. Cannot be changed later."
              }
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="key"
                  class="pk-mono"
                  autocomplete="off"
                  value={key}
                  placeholder="e.g. speaker_confirmation"
                  onInput={(e) => setKey((e.target as HTMLInputElement).value)}
                />
              )}
            </Field>

            <div class="pk-grid pk-grid--tight">
              <Field label="Content type" {...form.of("contentType")}>
                {(control) => (
                  <Select
                    {...control}
                    name="contentType"
                    value={contentType}
                    onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                  >
                    {EMAIL_CONTENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Default message type" {...form.of("messageType")}>
                {(control) => (
                  <Select
                    {...control}
                    name="messageType"
                    value={messageType}
                    onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
                  >
                    {EMAIL_MESSAGE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field
              label="Subject template"
              help="Leave this empty to keep the subject the sending code supplies."
              {...form.of("subjectTemplate")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="subjectTemplate"
                  class="pk-mono"
                  autocomplete="off"
                  value={subject}
                  placeholder="e.g. Your invitation to {{eventName}}"
                  onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
                />
              )}
            </Field>

            <Field label="Body" required {...form.of("content")}>
              {(control) =>
                contentType === "markdown" ? (
                  <MarkdownEditor
                    {...control}
                    name="content"
                    label="Body"
                    initialValue={body}
                    initialMode="visual"
                    onChange={setBody}
                  />
                ) : (
                  <Textarea
                    {...control}
                    name="content"
                    class="pk-mono"
                    rows={12}
                    value={body}
                    placeholder="Template body content…"
                    onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                  />
                )
              }
            </Field>

            {error && <Alert tone="danger">{error}</Alert>}

            <div class="pk-cluster">
              <Button
                type="submit"
                variant="primary"
                loading={saving}
                disabled={keyCheckStatus === "exists" || keyCheckStatus === "checking"}
              >
                {saving ? "Creating…" : "Create Template"}
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}

function EmailTemplateCreateOnly() {
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  if (createdKey) {
    return (
      <section class="pk pk-stack pk-stack--snug" aria-labelledby="email-template-created-heading">
        <h3 id="email-template-created-heading">Template created</h3>
        <p class="pk-small">
          {createdKey} was created. You do not have permission to view template history or activate versions.
        </p>
        <div class="pk-cluster">
          <Button variant="primary" size="sm" onClick={() => setCreatedKey(null)}>
            Create another template
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section class="pk pk-stack pk-stack--snug" aria-labelledby="email-template-create-heading">
      <h3 id="email-template-create-heading">Create email template</h3>
      <p class="pk-small">You can create a draft template without access to the template catalog.</p>
      <CreateTemplate canRead={false} onCreated={setCreatedKey} onCancel={() => undefined} showCancel={false} />
    </section>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

type TemplatesView = "list" | "create" | { key: string; initialVersion: EmailTemplateVersion | null };

export function EmailTemplates({
  canRead = true,
  canWrite,
  canManage = false,
}: {
  canRead?: boolean;
  canWrite: boolean;
  /** May archive and delete templates (`email-templates:manage`). */
  canManage?: boolean;
}) {
  const [view, setView] = useState<TemplatesView>("list");
  const tableActions = useRef<ApiTableActions | null>(null);

  async function archiveTemplate(templateKey: string) {
    const confirmed = await confirmAction({
      title: `Archive ${templateKey}?`,
      body: "Every version is retired.",
      consequences: [
        "Messages queued for this key fail to render until a version is activated again.",
        "The versions stay on record and can be activated later.",
      ],
      confirmLabel: "Archive template",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await postJson(`${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/archive`, {}, successResponseSchema);
      toast(`${templateKey} archived`, "success");
      await tableActions.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function deleteTemplate(templateKey: string) {
    const confirmed = await confirmAction({
      title: `Delete ${templateKey}?`,
      body: "The template and every version of it are removed.",
      consequences: [
        "This cannot be undone.",
        "Code that sends with this key will fail until a template exists again.",
      ],
      confirmLabel: "Delete template",
      tone: "danger",
      typedConfirmation: templateKey,
    });
    if (!confirmed) return;
    try {
      await deleteJson(`${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}`, successResponseSchema);
      toast(`${templateKey} deleted`, "success");
      await tableActions.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // Archive while anything is live; delete once nothing is. The command that
  // does not apply is absent rather than shown disabled.
  function rowActions(template: EmailTemplateSummary): MenuItem[] {
    return [
      ...(template.status !== "archived"
        ? [{ id: "archive", label: "Archive template", onSelect: () => void archiveTemplate(template.template_key) }]
        : []),
      ...(template.status !== "active"
        ? [
            {
              id: "delete",
              label: "Delete template",
              danger: true,
              separatorBefore: template.status !== "archived",
              onSelect: () => void deleteTemplate(template.template_key),
            },
          ]
        : []),
    ];
  }

  async function openEditor(key: string) {
    try {
      setView({ key, initialVersion: await getEmailTemplateEditorVersion(key) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!canRead) {
    return canWrite ? <EmailTemplateCreateOnly /> : null;
  }

  if (view !== "list" && view !== "create") {
    return (
      <TemplateEditor
        templateKey={view.key}
        initialVersion={view.initialVersion}
        canWrite={canWrite}
        onBack={() => setView("list")}
      />
    );
  }

  if (view === "create" && canWrite) {
    return (
      <CreateTemplate
        canRead={canRead}
        onCreated={(key) => {
          void openEditor(key);
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    // The catalog is the page under Settings, so it heads itself; the create
    // form and the editor below are screens this one opens, and carry their
    // own headings.
    <div class="pk pk-stack">
      <PageHeader title="Email templates" />
      <ApiDataTable
        caption="Email templates"
        urlState="templates"
        endpoint={EMAIL_TEMPLATES_API}
        responseSchema={emailTemplatesListResponseSchema}
        resolve={(data) => data.templates}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableActions}
        searchPlaceholder="Search template key…"
        createAction={canWrite ? { label: "New template", onSelect: () => setView("create") } : undefined}
        columns={[
          {
            header: "Template Key",
            cell: (t) => t.template_key,
            className: "pk-mono pk-small",
            width: "primary",
            sort: { asc: "template_key", desc: "-template_key" },
          },
          {
            // One word: the server states the template's lifecycle (#98). A
            // pending draft is noted under the active version rather than as
            // a second status.
            header: "Status",
            cell: (t) => <Badge status={t.status} />,
            width: "fit",
          },
          {
            header: "Active",
            cell: (t) => (
              <span class="pk-mono">
                {t.active_version != null ? `v${t.active_version}` : "—"}
                {t.draft_count > 0 && (
                  <span class="pk-small pk-muted">
                    {" "}
                    · {t.draft_count} {t.draft_count === 1 ? "draft" : "drafts"}
                  </span>
                )}
              </span>
            ),
            width: "fit",
            sort: { asc: "active_version", desc: "-active_version" },
          },
          {
            // When the template last changed, so a modified one is found at
            // a glance (#115).
            header: "Last changed",
            cell: (t) => fmt(t.last_changed_at),
            className: "pk-small",
            width: "fit",
            sort: { asc: "last_changed_at", desc: "-last_changed_at", defaultDirection: "desc" },
          },
          ...(canManage
            ? [
                {
                  header: "",
                  className: "pk-end",
                  width: "fit" as const,
                  cell: (t: EmailTemplateSummary) => <RowActions subject={t.template_key} actions={rowActions(t)} />,
                },
              ]
            : []),
        ]}
        empty={
          canWrite ? <EmptyState title="No templates yet" body="Create a template to get started." /> : "No templates"
        }
        rowKey={(t) => t.template_key}
        // The whole row opens the template. It used to be an "Edit →" button in
        // a nameless last column, which left the row itself inert.
        rowAction={(t) => ({
          label: `${canWrite ? "Edit" : "View"} ${t.template_key}`,
          onSelect: () => void openEditor(t.template_key),
        })}
      />
    </div>
  );
}
