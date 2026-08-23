import { useState, useEffect, useRef } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../components/ApiDataTable";
import { api } from "../api";
import { toast } from "../ui";
import type { EmailTemplateVersion } from "../types";
import {
  adminEmailTemplatesListResponseSchema,
  adminEmailTemplateExistsResponseSchema,
  adminEmailTemplateVersionCreateResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../../shared/schemas/admin-email-templates";
import { TemplateEditor } from "./EmailTemplateEditor";
import { getAdminEmailTemplateEditorVersion } from "../services/catalogs";

// ────────────────────────────────────────────────────────
// Create new template
// ────────────────────────────────────────────────────────

function CreateTemplate({ onCreated, onCancel }: { onCreated: (key: string) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<EmailContentType>("markdown");
  const [messageType, setMessageType] = useState<EmailMessageType>("transactional");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyCheckStatus, setKeyCheckStatus] = useState<"idle" | "checking" | "exists" | "available">("idle");

  useEffect(() => {
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
      setKeyCheckStatus("idle");
      return;
    }
    setKeyCheckStatus("checking");
    const timer = setTimeout(() => {
      api(`/api/v1/admin/email-templates/${encodeURIComponent(key)}/exists`, adminEmailTemplateExistsResponseSchema)
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
      await api(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
        adminEmailTemplateVersionCreateResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({
            content: body,
            subjectTemplate: subject || undefined,
            contentType,
            messageType,
          }),
        },
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
        <button class="btn btn-sm btn-secondary" onClick={onCancel}>
          ← Back to list
        </button>
      </div>
      <div class="card-body adm-template-create-form">
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Template key</label>
          <input
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
            <label class="form-label small fw-semibold mb-1">Content type</label>
            <select
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
            <label class="form-label small fw-semibold mb-1">Default message type</label>
            <select
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
          <label class="form-label small fw-semibold mb-1">Subject template</label>
          <input
            type="text"
            class="form-control form-control-sm font-monospace"
            value={subject}
            placeholder="e.g. Your invitation to {{eventName}}"
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Body</label>
          <textarea
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

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

type TemplatesView = "list" | "create" | { key: string; initialVersion: EmailTemplateVersion | null };

export function Templates() {
  const [view, setView] = useState<TemplatesView>("list");
  const tableRef = useRef<ApiTableActions | null>(null);

  async function openEditor(key: string) {
    try {
      setView({ key, initialVersion: await getAdminEmailTemplateEditorVersion(key) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (view !== "list" && view !== "create") {
    return (
      <TemplateEditor templateKey={view.key} initialVersion={view.initialVersion} onBack={() => setView("list")} />
    );
  }

  if (view === "create") {
    return (
      <CreateTemplate
        onCreated={async (key) => {
          tableRef.current?.reload();
          await openEditor(key);
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <ApiDataTable
      endpoint="/api/v1/admin/email-templates"
      responseSchema={adminEmailTemplatesListResponseSchema}
      resolve={(data) => data.templates}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search template key…"
      actionsRef={tableRef}
      toolbar={() => (
        <button class="btn btn-success btn-sm ms-auto" onClick={() => setView("create")}>
          + New Template
        </button>
      )}
      columns={[
        {
          header: "Template Key",
          cell: (t) => t.template_key,
          className: "mono adm-template-key",
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
              Edit →
            </button>
          ),
        },
      ]}
      empty="No templates"
      rowKey={(t) => t.template_key}
    />
  );
}
