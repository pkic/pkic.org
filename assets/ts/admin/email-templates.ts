import { badge, esc, fmt, hide, q, show, spinner, tbl, toast } from "./ui";
import { TEMPLATE_HELPERS, type TemplateHelperCategory } from "./email-template-helpers";

export interface EmailTemplateVersion {
  id: string;
  template_key: string;
  version: number;
  subject_template: string | null;
  body: string | null;
  content_type: string;
  r2_object_key: string | null;
  checksum_sha256: string;
  status: "draft" | "active";
  created_by_user_id: string | null;
  created_at: string;
}

type ApiClient = <T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }) => Promise<T>;

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";

export function createEmailTemplatesSection(api: ApiClient): { loadTemplates: () => Promise<void> } {
  let templateEditorFocus: "subject" | "body" = "body";
  let templateEditorKey: string | null = null;

  async function loadTemplates(): Promise<void> {
    const el = q("#t-body");
    if (!el) return;
    el.innerHTML = spinner();
    hide(q("#t-editor"));
    show(el);
    try {
      const data = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
      const grouped = groupTemplates(data.templates ?? []);

      if (!grouped.size) {
        el.innerHTML =
          '<p class="text-muted text-center py-3 fst-italic small">No email templates found. ' +
          "Use the seed script to populate initial templates.</p>";
        return;
      }

      const rows: string[] = [];
      grouped.forEach((versions, key) => {
        const active = versions.find((version) => version.status === "active");
        const hasDraft = versions.some((version) => version.status === "draft");
        rows.push(
          `<tr>` +
            `<td class="mono adm-template-key">${esc(key)}</td>` +
            `<td class="mono">${active ? `v${active.version}` : "&mdash;"}</td>` +
            `<td>${badge(active ? "active" : "draft")}${hasDraft && active ? ' <span class="badge text-bg-warning">draft pending</span>' : ""}</td>` +
            `<td class="mono">${versions.length}</td>` +
            `<td><button class="btn btn-sm btn-outline-success" data-edit-key="${esc(key)}">Edit &rarr;</button></td>` +
            `</tr>`,
        );
      });

      el.innerHTML = tbl(["Template Key", "Active", "Status", "Versions", ""], rows, "No templates found");

      el.querySelectorAll<HTMLButtonElement>("[data-edit-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.editKey!;
          openTemplate(key, grouped.get(key) ?? []);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  function openTemplate(key: string, versions: EmailTemplateVersion[]): void {
    const listEl = q("#t-body");
    const editorEl = q("#t-editor");
    if (!editorEl) return;
    templateEditorKey = key;
    hide(listEl);
    show(editorEl);

    const active = versions.find((version) => version.status === "active");
    const current = active ?? versions[0];
    const contentType = current?.content_type ?? "markdown";
    const isLayoutTemplate = key === EMAIL_LAYOUT_TEMPLATE_KEY;

    editorEl.innerHTML =
      '<div class="card border-0 shadow-sm">' +
        '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
          `<span class="fw-semibold">Edit: <span class="mono">${esc(key)}</span>${isLayoutTemplate ? ' <span class="badge text-bg-info ms-2">shared shell</span>' : ""}</span>` +
          '<button class="btn btn-sm btn-secondary" id="btn-close-template">&larr; Back to list</button>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="row g-3">' +
            '<div class="col-lg-7">' +
              (isLayoutTemplate ? '<div class="alert alert-info small py-2 mb-3">This template controls the outer email shell used for all emails.</div>' : "") +
              '<div class="mb-2">' +
                '<label class="form-label small fw-semibold mb-1" for="t-content-type">Content type</label>' +
                '<select class="form-select form-select-sm adm-template-content-type" id="t-content-type">' +
                  `<option value="markdown"${contentType === "markdown" ? " selected" : ""}>Markdown</option>` +
                  `<option value="html"${contentType === "html" ? " selected" : ""}>HTML</option>` +
                  `<option value="text"${contentType === "text" ? " selected" : ""}>Plain text</option>` +
                '</select>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label small fw-semibold mb-1" for="t-subject">' +
                  'Subject template <span class="text-muted fw-normal">(supports conditions and variables)</span>' +
                '</label>' +
                '<div class="adm-template-overlay-wrap">' +
                  '<pre id="t-subject-src" aria-hidden="true" class="adm-template-backdrop adm-template-backdrop-subject"></pre>' +
                  `<input type="text" class="form-control form-control-sm font-monospace adm-template-input-overlay" id="t-subject" value="${esc(current?.subject_template ?? "")}" placeholder="e.g. Your invitation to {{eventName}}">` +
                '</div>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label small fw-semibold mb-1" for="t-content">' +
                  'Body <span class="text-muted fw-normal">(supports {{variables}}, {{#if}}...{{/if}}, {{#each}}...{{/each}})</span>' +
                '</label>' +
                '<div class="adm-template-overlay-wrap">' +
                  '<pre id="t-content-src" aria-hidden="true" class="adm-template-backdrop adm-template-backdrop-body"></pre>' +
                  `<textarea class="form-control font-monospace adm-template-input-overlay adm-template-body-input" id="t-content" rows="16">${esc(current?.body ?? "")}</textarea>` +
                '</div>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label small fw-semibold mb-1">Template helpers</label>' +
                '<div class="small text-muted mb-2">Click to insert into the active field. If nothing is focused, helpers go into the body editor.</div>' +
                `<div id="t-helper-panel" class="d-flex gap-2 flex-wrap">${templateHelpersHtml()}</div>` +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label small fw-semibold mb-1" for="t-preview-data">Preview data (JSON)</label>' +
                '<textarea class="form-control font-monospace adm-template-preview-data" id="t-preview-data" rows="6" placeholder="Optional: provide sample variables as JSON"></textarea>' +
              '</div>' +
              '<div class="d-flex gap-2 align-items-center flex-wrap">' +
                '<button class="btn btn-outline-primary" id="btn-t-preview">Render Preview</button>' +
                '<button class="btn btn-success" id="btn-t-save">Save as Draft</button>' +
                '<span class="text-muted small">Saving creates a new draft version. Activate it below to put it in use.</span>' +
              '</div>' +
            '</div>' +
            '<div class="col-lg-5">' +
              '<div class="card border"><div class="card-header bg-light small fw-semibold">Rendered Preview</div>' +
                '<div class="card-body">' +
                  '<div class="mb-2"><div class="small text-muted">Subject</div><div id="t-preview-subject" class="fw-semibold"></div></div>' +
                  '<ul class="nav nav-tabs mb-2" role="tablist">' +
                    '<li class="nav-item"><button class="nav-link active" id="t-prev-tab-html" type="button">HTML</button></li>' +
                    '<li class="nav-item"><button class="nav-link" id="t-prev-tab-text" type="button">Text</button></li>' +
                  '</ul>' +
                  '<div id="t-prev-html-wrap"><iframe id="t-preview-html" class="adm-template-preview-frame"></iframe></div>' +
                  '<pre id="t-preview-text" class="json-out d-none adm-template-preview-text"></pre>' +
                  '<div id="t-preview-status" class="small text-muted mt-2">Preview not rendered yet.</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      versionHistoryHtml(versions);

    wireTemplateEditor(editorEl, key, versions, listEl);
    syncTemplateSourcePreview();
  }

  function versionHistoryHtml(versions: EmailTemplateVersion[]): string {
    return (
      '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
        '<h6 class="text-uppercase small fw-bold text-muted mb-2">Version History</h6>' +
        tbl(
          ["Version", "Status", "Checksum (prefix)", "Created", ""],
          versions.map((version) =>
            `<tr>` +
              `<td class="mono">v${version.version}</td>` +
              `<td>${badge(version.status)}</td>` +
              `<td class="mono adm-template-checksum">${esc(version.checksum_sha256.substring(0, 12))}&hellip;</td>` +
              `<td class="mono">${fmt(version.created_at)}</td>` +
              `<td class="text-nowrap">` +
                (version.status !== "active"
                  ? `<button class="btn btn-sm btn-outline-success me-1 adm-template-history-btn" data-activate-version="${version.version}">Activate</button>`
                  : '<span class="badge text-bg-success me-1">In use</span>') +
                `<button class="btn btn-sm btn-outline-secondary adm-template-history-btn" data-load-version="${version.version}">Load into editor</button>` +
              `</td>` +
            `</tr>`,
          ),
          "No versions yet",
        ) +
      '</div></div>'
    );
  }

  function wireTemplateEditor(
    editorEl: Element,
    key: string,
    versions: EmailTemplateVersion[],
    listEl: Element | null,
  ): void {
    q("#btn-close-template")?.addEventListener("click", () => {
      hide(editorEl);
      show(listEl);
    });

    q("#btn-t-save")?.addEventListener("click", () => void doSaveTemplateVersion(key));
    q("#btn-t-preview")?.addEventListener("click", () => void doRenderTemplatePreview());

    q("#t-subject")?.addEventListener("input", syncTemplateSourcePreview);
    q("#t-content")?.addEventListener("input", syncTemplateSourcePreview);
    q("#t-subject")?.addEventListener("focus", () => { templateEditorFocus = "subject"; });
    q("#t-content")?.addEventListener("focus", () => { templateEditorFocus = "body"; });
    editorEl.querySelectorAll<HTMLButtonElement>("[data-template-helper]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const snippet = btn.dataset.templateHelper ?? "";
        const preferredTarget = btn.dataset.templateTarget === "subject" ? "subject" : btn.dataset.templateTarget === "body" ? "body" : null;
        insertTemplateSnippet(snippet, preferredTarget);
      });
    });

    q("#t-content")?.addEventListener("scroll", () => {
      const pre = q<HTMLElement>("#t-content-src");
      const textarea = q<HTMLTextAreaElement>("#t-content");
      if (pre && textarea) {
        pre.scrollTop = textarea.scrollTop;
        pre.scrollLeft = textarea.scrollLeft;
      }
    });

    q("#t-prev-tab-html")?.addEventListener("click", () => setTemplatePreviewTab("html"));
    q("#t-prev-tab-text")?.addEventListener("click", () => setTemplatePreviewTab("text"));

    editorEl.querySelectorAll<HTMLButtonElement>("[data-activate-version]").forEach((btn) => {
      btn.addEventListener("click", () =>
        void doActivateTemplateVersion(key, parseInt(btn.dataset.activateVersion!, 10)),
      );
    });

    editorEl.querySelectorAll<HTMLButtonElement>("[data-load-version]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const versionNumber = parseInt(btn.dataset.loadVersion!, 10);
        const version = versions.find((candidate) => candidate.version === versionNumber);
        if (version) {
          const subject = q<HTMLInputElement>("#t-subject");
          const content = q<HTMLTextAreaElement>("#t-content");
          if (subject) subject.value = version.subject_template ?? "";
          if (content) content.value = version.body ?? "";
          syncTemplateSourcePreview();
          toast(`Loaded v${versionNumber} into editor`, "info");
        }
      });
    });
  }

  function templateHelpersHtml(): string {
    const categories: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];
    return categories.map((category) => {
      const items = TEMPLATE_HELPERS.filter((item) => item.category === category);
      return (
        '<div class="w-100">' +
          `<div class="small text-muted fw-semibold mb-1">${esc(category)}</div>` +
          '<div class="d-flex gap-2 flex-wrap">' +
            items.map((item) => {
              const targetAttr = item.target ? ` data-template-target="${item.target}"` : "";
              return `<button type="button" class="btn btn-sm btn-outline-secondary" data-template-helper="${esc(item.snippet)}"${targetAttr}>${esc(item.label)}</button>`;
            }).join("") +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function insertTemplateSnippet(snippet: string, preferredTarget?: "subject" | "body" | null): void {
    const target = preferredTarget ?? templateEditorFocus;
    const subjectEl = q<HTMLInputElement>("#t-subject");
    const bodyEl = q<HTMLTextAreaElement>("#t-content");
    const field = target === "subject" ? subjectEl : bodyEl;
    if (!field) return;

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = `${field.value.slice(0, start)}${snippet}${field.value.slice(end)}`;
    const nextPos = start + snippet.length;
    field.focus();
    if (typeof field.setSelectionRange === "function") {
      field.setSelectionRange(nextPos, nextPos);
    }
    templateEditorFocus = field === subjectEl ? "subject" : "body";
    syncTemplateSourcePreview();
  }

  function highlightTemplateSyntax(source: string): string {
    const out: string[] = [];
    const stack: number[] = [];
    let pos = 0;

    while (pos < source.length) {
      const start = source.indexOf("{{", pos);
      if (start === -1) {
        out.push(esc(source.slice(pos)));
        break;
      }
      if (start > pos) out.push(esc(source.slice(pos, start)));

      const end = source.indexOf("}}", start + 2);
      if (end === -1) {
        out.push(esc(source.slice(start)));
        break;
      }

      const token = source.slice(start, end + 2);
      const inner = source.slice(start + 2, end).trim();
      let tokenClass = "adm-template-token-var";

      if (inner.startsWith("#")) {
        const depth = stack.length % 8;
        stack.push(depth);
        tokenClass = `adm-template-token-depth-${depth}`;
      } else if (inner.startsWith("/")) {
        const depth = stack.length > 0 ? stack.pop()! : 0;
        tokenClass = `adm-template-token-depth-${depth % 8}`;
      } else if (inner === "else") {
        const depth = stack.length > 0 ? stack[stack.length - 1] : 0;
        tokenClass = `adm-template-token-depth-${depth % 8}`;
      }

      out.push(`<span class="adm-template-token ${tokenClass}">${esc(token)}</span>`);
      pos = end + 2;
    }

    return out.join("");
  }

  function syncTemplateSourcePreview(): void {
    const subjectEl = q<HTMLInputElement>("#t-subject");
    const contentEl = q<HTMLTextAreaElement>("#t-content");
    const subject = subjectEl?.value ?? "";
    const content = contentEl?.value ?? "";
    const subjectOut = q<HTMLElement>("#t-subject-src");
    const contentOut = q<HTMLElement>("#t-content-src");

    subjectEl?.classList.toggle("adm-template-input-hidden-text", Boolean(subject));
    if (subjectOut) subjectOut.innerHTML = subject ? `${highlightTemplateSyntax(subject)}&nbsp;` : "";
    if (contentOut) contentOut.innerHTML = `${highlightTemplateSyntax(content)}\n`;
    if (contentEl && contentOut) {
      contentOut.scrollTop = contentEl.scrollTop;
      contentOut.scrollLeft = contentEl.scrollLeft;
    }
  }

  function setTemplatePreviewTab(tab: "html" | "text"): void {
    const htmlBtn = q<HTMLButtonElement>("#t-prev-tab-html");
    const textBtn = q<HTMLButtonElement>("#t-prev-tab-text");
    const htmlWrap = q("#t-prev-html-wrap");
    const textWrap = q("#t-preview-text");
    if (tab === "html") {
      htmlBtn?.classList.add("active");
      textBtn?.classList.remove("active");
      show(htmlWrap);
      hide(textWrap);
    } else {
      textBtn?.classList.add("active");
      htmlBtn?.classList.remove("active");
      hide(htmlWrap);
      show(textWrap);
    }
  }

  async function doRenderTemplatePreview(): Promise<void> {
    const subjectTemplate = q<HTMLInputElement>("#t-subject")?.value.trim() ?? "";
    const content = q<HTMLTextAreaElement>("#t-content")?.value ?? "";
    const contentType = (q<HTMLSelectElement>("#t-content-type")?.value ?? "markdown") as "markdown" | "html" | "text";
    const dataRaw = q<HTMLTextAreaElement>("#t-preview-data")?.value.trim() ?? "";
    const statusEl = q("#t-preview-status");
    const isLayoutTemplate = templateEditorKey === EMAIL_LAYOUT_TEMPLATE_KEY;

    if (!content.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }

    let data: Record<string, unknown> | undefined;
    if (dataRaw) {
      try {
        const parsed = JSON.parse(dataRaw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Preview data must be a JSON object");
        }
        data = parsed as Record<string, unknown>;
      } catch (err) {
        const message = `Invalid preview data JSON: ${(err as Error).message}`;
        toast(message, "error");
        if (statusEl) statusEl.textContent = message;
        return;
      }
    }

    if (statusEl) statusEl.textContent = "Rendering preview...";

    try {
      const layoutHtml = isLayoutTemplate ? content : undefined;
      const previewContent = isLayoutTemplate
        ? "<h2>Layout preview</h2><p>This is how body content will appear inside the shared email shell.</p>"
        : content;
      const previewContentType = isLayoutTemplate ? "html" : contentType;
      const result = await api<{ subject: string; html: string; text: string }>(
        "/api/v1/admin/email-templates/preview",
        {
          method: "POST",
          body: JSON.stringify({
            subjectTemplate: subjectTemplate || undefined,
            content: previewContent,
            contentType: previewContentType,
            layoutHtml,
            data,
          }),
        },
      );

      const subjectEl = q("#t-preview-subject");
      const iframe = q<HTMLIFrameElement>("#t-preview-html");
      const textEl = q<HTMLElement>("#t-preview-text");

      if (subjectEl) subjectEl.textContent = result.subject;
      if (iframe) iframe.srcdoc = result.html;
      if (textEl) textEl.textContent = result.text;
      if (statusEl) statusEl.textContent = "Preview rendered.";
    } catch (err) {
      const message = (err as Error).message;
      toast(message, "error");
      if (statusEl) statusEl.textContent = message;
    }
  }

  async function doSaveTemplateVersion(key: string): Promise<void> {
    const subject = q<HTMLInputElement>("#t-subject")?.value.trim() ?? "";
    const content = q<HTMLTextAreaElement>("#t-content")?.value ?? "";
    const contentType = templateEditorKey === EMAIL_LAYOUT_TEMPLATE_KEY
      ? "html"
      : (q<HTMLSelectElement>("#t-content-type")?.value ?? "markdown") as "markdown" | "html" | "text";
    const btn = q<HTMLButtonElement>("#btn-t-save");
    if (!content.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      const result = await api<{ success: boolean; version: number }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
        { method: "POST", body: JSON.stringify({ content, subjectTemplate: subject || undefined, contentType }) },
      );
      toast(`Saved as draft v${result.version}`, "success");
      await reloadTemplate(key);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save as Draft";
      }
    }
  }

  async function doActivateTemplateVersion(key: string, version: number): Promise<void> {
    try {
      await api(`/api/v1/admin/email-templates/${encodeURIComponent(key)}/activate`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
      toast(`v${version} is now active`, "success");
      await reloadTemplate(key);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function reloadTemplate(key: string): Promise<void> {
    const data = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
    const grouped = groupTemplates(data.templates ?? []);
    openTemplate(key, grouped.get(key) ?? []);
  }

  return { loadTemplates };
}

function groupTemplates(templates: EmailTemplateVersion[]): Map<string, EmailTemplateVersion[]> {
  const grouped = new Map<string, EmailTemplateVersion[]>();
  for (const template of templates) {
    const list = grouped.get(template.template_key) ?? [];
    list.push(template);
    grouped.set(template.template_key, list);
  }
  return grouped;
}
