import { useState, useEffect } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field, type FieldState } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { getJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import type { EmailTemplateVersion } from "../../../../../shared/schemas/email-templates";
import {
  emailTemplatesListResponseSchema,
  emailTemplateExistsResponseSchema,
  emailTemplateVersionCreateResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../../../../shared/schemas/email-templates";
import { TemplateEditor } from "./EmailTemplateEditor";
import { EMAIL_TEMPLATES_API, getEmailTemplateEditorVersion } from "../../../../shared/email-template-catalog";

// The key, the subject and the body are code, so they are set in `pk-mono`.
// Content.css rides a lazy chunk rather than the entry stylesheet, so the
// module that writes the class has to import it or the text renders in the
// body face.
import "../../../../ui/Content.css";

const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

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
  const [keyCheckStatus, setKeyCheckStatus] = useState<"idle" | "checking" | "exists" | "available">("idle");

  useEffect(() => {
    if (!canRead) {
      setKeyCheckStatus("idle");
      return;
    }
    if (!key || !TEMPLATE_KEY_PATTERN.test(key)) {
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

  const keyError =
    key && !TEMPLATE_KEY_PATTERN.test(key)
      ? "Use lowercase letters, digits, and underscores only (must start with a letter)"
      : keyCheckStatus === "exists"
        ? "A template with this key already exists"
        : null;

  // A checked-and-good key gets a state of its own rather than a green border:
  // Field draws each state as a mark as well as a hue, and only the blocking
  // one sets aria-invalid.
  const keyState: FieldState | undefined = keyError ? "invalid" : keyCheckStatus === "available" ? "ok" : undefined;
  const keyMessage = keyError ?? (keyCheckStatus === "available" ? "Key is available" : undefined);

  async function doCreate() {
    if (!key || keyError) {
      toast("Fix the template key first", "error");
      return;
    }
    if (keyCheckStatus === "checking") {
      toast("Still checking key availability, please wait", "error");
      return;
    }
    if (!body.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }
    setSaving(true);
    try {
      await postJson(
        `${EMAIL_TEMPLATES_API}/${encodeURIComponent(key)}/versions`,
        {
          content: body,
          subjectTemplate: subject || undefined,
          contentType,
          messageType,
        },
        emailTemplateVersionCreateResponseSchema,
      );
      toast(`Template "${key}" created as draft v1`, "success");
      onCreated(key);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-container pk-container--narrow">
      <Panel>
        <PanelHeader title="Create New Template" headingLevel={2}>
          {showCancel && (
            <Button size="sm" onClick={onCancel}>
              ← Back to list
            </Button>
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          <Field
            label="Template key"
            required
            state={keyState}
            message={keyMessage}
            help={
              keyCheckStatus === "checking"
                ? "Checking availability…"
                : "A unique identifier for this template. Cannot be changed later."
            }
          >
            {(control) => (
              <TextInput
                {...control}
                class="pk-mono"
                autocomplete="off"
                value={key}
                placeholder="e.g. speaker_confirmation"
                onInput={(e) => setKey((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>

          <div class="pk-grid pk-grid--tight">
            <Field label="Content type">
              {(control) => (
                <Select
                  {...control}
                  value={contentType}
                  onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                >
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="text">Plain text</option>
                </Select>
              )}
            </Field>
            <Field label="Default message type">
              {(control) => (
                <Select
                  {...control}
                  value={messageType}
                  onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
                >
                  <option value="transactional">Transactional</option>
                  <option value="promotional">Promotional</option>
                </Select>
              )}
            </Field>
          </div>

          <Field label="Subject template" help="Leave this empty to keep the subject the sending code supplies.">
            {(control) => (
              <TextInput
                {...control}
                class="pk-mono"
                autocomplete="off"
                value={subject}
                placeholder="e.g. Your invitation to {{eventName}}"
                onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>

          <Field label="Body" required>
            {(control) => (
              <Textarea
                {...control}
                class="pk-mono"
                rows={12}
                value={body}
                placeholder="Template body content…"
                onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              />
            )}
          </Field>

          <div class="pk-cluster">
            <Button
              variant="primary"
              onClick={() => void doCreate()}
              loading={saving}
              disabled={!key || Boolean(keyError) || keyCheckStatus === "checking"}
            >
              {saving ? "Creating…" : "Create Template"}
            </Button>
          </div>
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
        <h2 id="email-template-created-heading">Template created</h2>
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
      <h2 id="email-template-create-heading">Create email template</h2>
      <p class="pk-small">You can create a draft template without access to the template catalog.</p>
      <CreateTemplate canRead={false} onCreated={setCreatedKey} onCancel={() => undefined} showCancel={false} />
    </section>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

type TemplatesView = "list" | "create" | { key: string; initialVersion: EmailTemplateVersion | null };

export function EmailTemplates({ canRead = true, canWrite }: { canRead?: boolean; canWrite: boolean }) {
  const [view, setView] = useState<TemplatesView>("list");

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
    <ApiDataTable
      caption="Email templates"
      urlState="templates"
      endpoint={EMAIL_TEMPLATES_API}
      responseSchema={emailTemplatesListResponseSchema}
      resolve={(data) => data.templates}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search template key…"
      createAction={canWrite ? { label: "New template", onSelect: () => setView("create") } : undefined}
      columns={[
        {
          header: "Template Key",
          cell: (t) => t.template_key,
          className: "pk-mono pk-small",
          sort: { asc: "template_key", desc: "-template_key" },
        },
        {
          header: "Active",
          cell: (t) => (t.active_version != null ? `v${t.active_version}` : "—"),
          className: "pk-mono",
          sort: { asc: "active_version", desc: "-active_version" },
        },
        {
          header: "Status",
          cell: (t) => {
            const hasActive = t.active_version != null;
            return (
              <div class="pk-cluster">
                <Badge status={hasActive ? "active" : "draft"} />
                {hasActive && t.draft_count > 0 && <ToneBadge tone="warn">draft pending</ToneBadge>}
              </div>
            );
          },
        },
        {
          header: "Versions",
          cell: (t) => t.version_count,
          className: "pk-mono",
          sort: { asc: "version_count", desc: "-version_count", defaultDirection: "desc" },
        },
        {
          header: "",
          cell: (t) => (
            <Button size="sm" onClick={() => void openEditor(t.template_key)}>
              {canWrite ? "Edit" : "View"} →
            </Button>
          ),
        },
      ]}
      empty={
        canWrite ? <EmptyState title="No templates yet" body="Create a template to get started." /> : "No templates"
      }
      rowKey={(t) => t.template_key}
    />
  );
}
