import { useState, useEffect } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
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
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
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
    key && !/^[a-z][a-z0-9_]*$/.test(key)
      ? "Use lowercase letters, digits, and underscores only (must start with a letter)"
      : keyCheckStatus === "exists"
        ? "A template with this key already exists"
        : null;

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
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white d-flex align-items-center justify-content-between">
        <span class="fw-semibold">Create New Template</span>
        {showCancel && (
          <button class="btn btn-sm btn-secondary" onClick={onCancel}>
            ← Back to list
          </button>
        )}
      </div>
      <div class="card-body adm-template-create-form">
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1" for="email-template-key">
            Template key
          </label>
          <input
            id="email-template-key"
            type="text"
            class={`form-control form-control-sm font-monospace${keyError ? " is-invalid" : keyCheckStatus === "available" ? " is-valid" : ""}`}
            value={key}
            placeholder="e.g. speaker_confirmation"
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
          {keyError && <div class="invalid-feedback">{keyError}</div>}
          {keyCheckStatus === "available" && <div class="valid-feedback">Key is available</div>}
          <div class="form-text">
            {keyCheckStatus === "checking"
              ? "Checking availability…"
              : "A unique identifier for this template. Cannot be changed later."}
          </div>
        </div>
        <div class="row g-2 mb-3">
          <div class="col-md-6">
            <label class="form-label small fw-semibold mb-1" for="email-template-content-type">
              Content type
            </label>
            <select
              id="email-template-content-type"
              class="form-select form-select-sm"
              value={contentType}
              onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
            >
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
              <option value="text">Plain text</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-semibold mb-1" for="email-template-message-type">
              Default message type
            </label>
            <select
              id="email-template-message-type"
              class="form-select form-select-sm"
              value={messageType}
              onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
            >
              <option value="transactional">Transactional</option>
              <option value="promotional">Promotional</option>
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1" for="email-template-subject">
            Subject template
          </label>
          <input
            id="email-template-subject"
            type="text"
            class="form-control form-control-sm font-monospace"
            value={subject}
            placeholder="e.g. Your invitation to {{eventName}}"
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1" for="email-template-body">
            Body
          </label>
          <textarea
            id="email-template-body"
            class="form-control font-monospace"
            rows={12}
            value={body}
            placeholder="Template body content…"
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <button
          class="btn btn-success"
          onClick={() => void doCreate()}
          disabled={saving || !key || !!keyError || keyCheckStatus === "checking"}
        >
          {saving ? "Creating…" : "Create Template"}
        </button>
      </div>
    </div>
  );
}

function EmailTemplateCreateOnly() {
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  if (createdKey) {
    return (
      <section aria-labelledby="email-template-created-heading">
        <h5 id="email-template-created-heading" class="mb-2">
          Template created
        </h5>
        <p class="text-muted small">
          {createdKey} was created. You do not have permission to view template history or activate versions.
        </p>
        <button type="button" class="btn btn-sm btn-primary" onClick={() => setCreatedKey(null)}>
          Create another template
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="email-template-create-heading">
      <h5 id="email-template-create-heading" class="mb-2">
        Create email template
      </h5>
      <p class="text-muted small">You can create a draft template without access to the template catalog.</p>
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
          className: "mono small",
          sort: { asc: "template_key", desc: "-template_key" },
        },
        {
          header: "Active",
          cell: (t) => (t.active_version != null ? `v${t.active_version}` : "—"),
          className: "mono",
          sort: { asc: "active_version", desc: "-active_version" },
        },
        {
          header: "Status",
          cell: (t) => {
            const hasActive = t.active_version != null;
            const hasDraft = t.draft_count > 0;
            return (
              <>
                <Badge status={hasActive ? "active" : "draft"} />
                {hasDraft && hasActive && <span class="badge text-bg-warning ms-1">draft pending</span>}
              </>
            );
          },
        },
        {
          header: "Versions",
          cell: (t) => t.version_count,
          className: "mono",
          sort: { asc: "version_count", desc: "-version_count", defaultDirection: "desc" },
        },
        {
          header: "",
          cell: (t) => (
            <button class="btn btn-sm btn-outline-success" onClick={() => void openEditor(t.template_key)}>
              {canWrite ? "Edit" : "View"} →
            </button>
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
