import { AdminEventFormSummary, AdminFormDetailField, AdminFormSubmission } from "./types";
import { esc, q, spinner, tbl, badge, fmt, toast } from "./ui";

type ApiFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export function eventTermsTabHtml(): string {
  return (
    '<h5 class="mb-3">Event Terms & Policies</h5>' +
    '<p class="text-muted small">Configure various terms that users must agree to during registration or proposal submission.</p>' +
    '<div id="terms-list" class="tbl-wrap"></div>'
  );
}

export async function loadEventTerms(api: ApiFn, slug: string): Promise<void> {
  const root = q("#terms-list");
  if (!root) return;
  root.innerHTML = spinner();
  try {
    const res = await api<{ terms: Array<{ id: string; key: string; title: string; required: boolean; version: number }> }>(
      `/api/v1/admin/events/${slug}/terms`
    );
    root.innerHTML = tbl(
      ["Key", "Title", "Version", "Required", ""],
      res.terms.map(
        (t) =>
          `<tr>` +
          `<td class="mono small">${esc(t.key)}</td>` +
          `<td>${esc(t.title)}</td>` +
          `<td class="mono small">v${t.version}</td>` +
          `<td>${t.required ? '<span class="text-danger">Yes</span>' : "No"}</td>` +
          `<td class="text-end"><button class="btn btn-sm btn-outline-secondary" disabled>View Policy</button></td>` +
          `</tr>`
      ),
      "No terms defined for this event."
    );
  } catch (err) {
    root.innerHTML = `<div class="alert alert-danger">${(err as Error).message}</div>`;
  }
}

export function eventFormsTabHtml(): string {
  return (
    '<div class="d-flex justify-content-between align-items-center mb-3">' +
    '<div><h5 class="mb-0">Custom Forms</h5><div class="text-muted small">Manage registration, call for papers, and survey forms.</div></div>' +
    '<button class="btn btn-sm btn-primary" id="btn-add-form">+ New form</button>' +
    '</div>' +
    '<div class="row">' +
    '<div class="col-md-5"><div id="forms-list" class="tbl-wrap"></div></div>' +
    '<div class="col-md-7"><div id="forms-detail"></div></div>' +
    '</div>'
  );
}

export async function loadEventForms(api: ApiFn, slug: string): Promise<void> {
  const root = q("#forms-list");
  if (!root) return;
  root.innerHTML = spinner();
  try {
    const res = await api<{ forms: AdminEventFormSummary[] }>(`/api/v1/admin/events/${slug}/forms`);
    root.innerHTML = tbl(
      ["Title", "Status", ""],
      res.forms.map(
        (f) =>
          `<tr>` +
          `<td><div class="fw-semibold small">${esc(f.title)}</div><div class="text-muted extra-small mono">${esc(f.key)}</div></td>` +
          `<td>${badge(f.status)}</td>` +
          `<td class="text-end"><button class="btn btn-sm btn-outline-primary" data-open-form="${esc(f.key)}">Manage</button></td>` +
          `</tr>`
      ),
      "No forms created for this event."
    );

    q("#btn-add-form")?.addEventListener("click", () => renderNewFormPanel(api, slug));

    root.querySelectorAll<HTMLButtonElement>("[data-open-form]").forEach((btn) => {
      btn.onclick = () => openFormDetail(api, btn.dataset.openForm!, slug);
    });
  } catch (err) {
    if (root) root.innerHTML = `<div class="alert alert-danger">${(err as Error).message}</div>`;
  }
}

function formFieldEditorRow(field?: AdminFormDetailField): string {
  const optionsText = Array.isArray(field?.options) ? (field?.options as string[]).join(", ") : "";
  return (
    '<tr class="form-field-row">' +
    `<td><input class="form-control form-control-sm mono" data-f-key value="${esc(field?.key ?? "")}" placeholder="field_key"></td>` +
    `<td><input class="form-control form-control-sm" data-f-label value="${esc(field?.label ?? "")}" placeholder="Label"></td>` +
    '<td><select class="form-select form-select-sm" data-f-type>' +
    ["text", "textarea", "select", "multi_select", "boolean", "number", "date", "email", "url"].map((t) => `<option value="${t}"${field?.fieldType === t ? " selected" : ""}>${t}</option>`).join("") +
    '</select></td>' +
    `<td><input class="form-control form-control-sm" data-f-options value="${esc(optionsText)}" placeholder="a, b, c"></td>` +
    `<td><input class="form-control form-control-sm" data-f-sort type="number" value="${esc(field?.sortOrder ?? 0)}"></td>` +
    `<td class="text-center"><input class="form-check-input" data-f-required type="checkbox" ${field?.required ? "checked" : ""}></td>` +
    '<td><button class="btn btn-sm btn-outline-danger" data-f-remove>&times;</button></td>' +
    '</tr>'
  );
}

function renderNewFormPanel(api: ApiFn, slug: string): void {
  const detail = q("#forms-detail");
  if (!detail) return;
  detail.innerHTML =
    '<div class="card border-0 shadow-sm"><div class="card-header bg-white fw-semibold">New form</div><div class="card-body">' +
    '<div class="row g-2 mb-2">' +
    '<div class="col-md-4"><label class="form-label small">Key</label><input class="form-control form-control-sm mono" id="new-form-key" placeholder="key-2026"></div>' +
    '<div class="col-md-4"><label class="form-label small">Purpose</label><select class="form-select form-select-sm" id="new-form-purpose"><option value="event_registration">event_registration</option><option value="proposal_submission">proposal_submission</option><option value="survey">survey</option><option value="feedback">feedback</option><option value="application">application</option></select></div>' +
    '<div class="col-md-4"><label class="form-label small">Status</label><select class="form-select form-select-sm" id="new-form-status-select"><option value="active">active</option><option value="inactive">inactive</option></select></div>' +
    '</div>' +
    '<div class="row g-2 mb-2">' +
    '<div class="col-md-6"><label class="form-label small">Title</label><input class="form-control form-control-sm" id="new-form-title"></div>' +
    '<div class="col-md-6"><label class="form-label small">Description</label><input class="form-control form-control-sm" id="new-form-description"></div>' +
    '</div>' +
    '<div class="d-flex gap-2 mb-2"><button class="btn btn-sm btn-outline-secondary" id="new-form-add-field">+ Field</button></div>' +
    '<div class="tbl-wrap"><table class="table table-sm"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Options</th><th>Sort</th><th>Req.</th><th></th></tr></thead><tbody id="new-form-fields"></tbody></table></div>' +
    '<div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-success" id="new-form-save">Create form</button><button class="btn btn-sm btn-outline-secondary" id="new-form-cancel">Cancel</button><span id="new-form-status-msg" class="small"></span></div>' +
    '</div></div>';

  const fieldsBody = q("#new-form-fields");
  fieldsBody?.insertAdjacentHTML("beforeend", formFieldEditorRow());

  q("#new-form-add-field")?.addEventListener("click", () => {
    fieldsBody?.insertAdjacentHTML("beforeend", formFieldEditorRow());
    wireFormFieldRows(fieldsBody);
  });
  q("#new-form-cancel")?.addEventListener("click", () => {
    if (detail) detail.innerHTML = "";
  });
  q("#new-form-save")?.addEventListener("click", () => void createForm(api, slug));
  wireFormFieldRows(fieldsBody);
}

function wireFormFieldRows(root: Element | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("[data-f-remove]").forEach((btn) => {
    btn.onclick = () => btn.closest(".form-field-row")?.remove();
  });
}

function collectFormFields(selector: string): Array<Record<string, unknown>> {
  return Array.from(document.querySelectorAll(`${selector} .form-field-row`)).map((row, idx) => {
    const optionsRaw = (row.querySelector<HTMLInputElement>("[data-f-options]")?.value ?? "").trim();
    const options = optionsRaw ? optionsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    return {
      key: (row.querySelector<HTMLInputElement>("[data-f-key]")?.value ?? "").trim(),
      label: (row.querySelector<HTMLInputElement>("[data-f-label]")?.value ?? "").trim(),
      fieldType: (row.querySelector<HTMLSelectElement>("[data-f-type]")?.value ?? "text").trim(),
      required: Boolean(row.querySelector<HTMLInputElement>("[data-f-required]")?.checked),
      sortOrder: parseInt(row.querySelector<HTMLInputElement>("[data-f-sort]")?.value ?? String((idx + 1) * 10), 10) || (idx + 1) * 10,
      options,
    };
  }).filter((f) => (f.key as string) && (f.label as string));
}

async function createForm(api: ApiFn, slug: string): Promise<void> {
  const statusEl = q("#new-form-status-msg");
  const payload = {
    key: (q<HTMLInputElement>("#new-form-key")?.value ?? "").trim(),
    purpose: (q<HTMLSelectElement>("#new-form-purpose")?.value ?? "event_registration").trim(),
    status: (q<HTMLSelectElement>("#new-form-status-select")?.value ?? "active").trim(),
    title: (q<HTMLInputElement>("#new-form-title")?.value ?? "").trim(),
    description: (q<HTMLInputElement>("#new-form-description")?.value ?? "").trim() || undefined,
    fields: collectFormFields("#new-form-fields"),
  };
  try {
    if (statusEl) { statusEl.textContent = "Creating..."; statusEl.className = "small text-muted"; }
    await api(`/api/v1/admin/events/${slug}/forms`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (statusEl) { statusEl.textContent = "Created"; statusEl.className = "small text-success"; }
    toast("Form created", "success");
    await loadEventForms(api, slug);
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    toast((err as Error).message, "error");
  }
}

async function openFormDetail(api: ApiFn, formKey: string, slug?: string): Promise<void> {
  const detail = q("#forms-detail");
  if (!detail) return;
  detail.innerHTML = spinner();
  try {
    const [formRes, submissionRes] = await Promise.all([
      api<{ form: AdminEventFormSummary; fields: AdminFormDetailField[] }>(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`),
      api<{ submissions: AdminFormSubmission[]; total: number }>(`/api/v1/admin/forms/${encodeURIComponent(formKey)}/submissions?limit=200`),
    ]);

    const form = formRes.form;
    const fields = formRes.fields ?? [];
    const submissions = submissionRes.submissions ?? [];

    detail.innerHTML =
      '<div class="card border-0 shadow-sm"><div class="card-header bg-white d-flex justify-content-between align-items-center">' +
      `<span class="fw-semibold">Form: <span class="mono">${esc(form.key)}</span></span>` +
      '<div class="d-flex gap-2"><button class="btn btn-sm btn-outline-danger" id="form-delete">Archive/Delete</button></div>' +
      '</div><div class="card-body">' +
      '<div class="row g-2 mb-2">' +
        `<div class="col-md-6"><label class="form-label small">Title</label><input class="form-control form-control-sm" id="form-edit-title" value="${esc(form.title)}"></div>` +
        `<div class="col-md-3"><label class="form-label small">Status</label><select class="form-select form-select-sm" id="form-edit-status"><option value="active"${form.status === "active" ? " selected" : ""}>active</option><option value="inactive"${form.status === "inactive" ? " selected" : ""}>inactive</option><option value="archived"${form.status === "archived" ? " selected" : ""}>archived</option></select></div>` +
        `<div class="col-md-3"><label class="form-label small">Purpose</label><input class="form-control form-control-sm" value="${esc(form.purpose)}" disabled></div>` +
      '</div>' +
      `<div class="mb-2"><label class="form-label small">Description</label><input class="form-control form-control-sm" id="form-edit-description" value="${esc(form.description ?? "")}"></div>` +
      '<div class="d-flex gap-2 mb-2"><button class="btn btn-sm btn-outline-secondary" id="form-add-field">+ Field</button><button class="btn btn-sm btn-primary" id="form-save">Save form</button><span class="small" id="form-save-status"></span></div>' +
      '<div class="tbl-wrap mb-3"><table class="table table-sm"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Options</th><th>Sort</th><th>Req.</th><th></th></tr></thead><tbody id="form-edit-fields">' +
      fields.map((f) => formFieldEditorRow(f)).join("") +
      '</tbody></table></div>' +
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Submissions (' + submissions.length + ')</h6>' +
      tbl(
        ["Submitted", "Status", "Submitter", "Context", "Answers", ""],
        submissions.map((s) =>
          `<tr>` +
          `<td class="mono small">${fmt(s.submittedAt)}</td>` +
          `<td>${badge(s.status)}</td>` +
          `<td>${s.submitter ? esc([s.submitter.firstName, s.submitter.lastName].filter(Boolean).join(" ") || s.submitter.email || s.submitter.id) : "—"}</td>` +
          `<td class="small text-muted">${esc([s.contextType, s.contextRef].filter(Boolean).join(" / ") || "—")}</td>` +
          `<td class="mono small">${Object.keys(s.answers || {}).length}</td>` +
          `<td><button class="btn btn-sm btn-outline-secondary" data-open-answers="${esc(s.id)}">View</button></td>` +
          `</tr>` +
          `<tr class="d-none" id="answers-${esc(s.id)}"><td colspan="6"><pre class="json-out mb-0">${esc(JSON.stringify(s.answers, null, 2))}</pre></td></tr>`
        ),
        "No submissions yet"
      ) +
      '</div></div>';

    const fieldsRoot = q("#form-edit-fields");
    wireFormFieldRows(fieldsRoot);

    q("#form-add-field")?.addEventListener("click", () => {
      fieldsRoot?.insertAdjacentHTML("beforeend", formFieldEditorRow());
      wireFormFieldRows(fieldsRoot);
    });

    q("#form-save")?.addEventListener("click", async () => {
      const statusEl = q("#form-save-status");
      const payload = {
        title: (q<HTMLInputElement>("#form-edit-title")?.value ?? "").trim(),
        description: (q<HTMLInputElement>("#form-edit-description")?.value ?? "").trim() || null,
        status: (q<HTMLSelectElement>("#form-edit-status")?.value ?? "active").trim(),
        fields: collectFormFields("#form-edit-fields"),
      };
      try {
        if (statusEl) { statusEl.textContent = "Saving..."; statusEl.className = "small text-muted"; }
        await api(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (statusEl) { statusEl.textContent = "Saved"; statusEl.className = "small text-success"; }
        toast("Form updated", "success");
        await openFormDetail(api, formKey, slug);
      } catch (err) {
        if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
        toast((err as Error).message, "error");
      }
    });

    q("#form-delete")?.addEventListener("click", async () => {
      const ok = window.confirm("Archive/delete this form? Existing submissions are preserved and force archive mode.");
      if (!ok) return;
      try {
        await api(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`, { method: "DELETE" });
        toast("Form archived/deleted", "success");
        detail.innerHTML = "";
        if (slug) await loadEventForms(api, slug);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

    detail.querySelectorAll<HTMLButtonElement>("[data-open-answers]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.openAnswers!;
        const row = q(`#answers-${id}`);
        if (row) row.classList.toggle("d-none");
      });
    });
  } catch (err) {
    if (detail) detail.innerHTML = `<div class="alert alert-danger">${(err as Error).message}</div>`;
  }
}
