import { z } from "zod";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { esc, fmt, hide, q, resetButton, setButtonLoading, show, spinner, tbl, toast } from "./ui";
import type { AdminInviteEntry, ApiFn, InviteRecord } from "./types";

export function createInvitesSection(api: ApiFn): {
  inviteFormHtml: (slug: string) => string;
  inviteListHtml: (slug: string) => string;
  inviteBadge: (status: string) => string;
  parseAdminInviteText: (text: string) => { valid: AdminInviteEntry[]; skipped: number };
  parseAdminCsv: (text: string) => { valid: AdminInviteEntry[]; skipped: number };
  wireInviteForm: (slug: string) => void;
  loadEventInvites: (slug: string, statusFilter?: string) => Promise<void>;
} {
  function inviteFormHtml(slug: string): string {
    void slug; // used by wireInviteForm
    return (
      '<div id="admin-invite-wrap">' +
      // ── Paste zone
      '<div class="mb-3">' +
        '<label class="form-label small fw-semibold">Paste emails &amp; names'
        + ' <span class="text-muted fw-normal">— one per line; supports <code>Name &lt;email&gt;</code>'
        + ', dotted addresses, or CSV (email, first, last)</span></label>' +
        '<textarea class="form-control form-control-sm" id="inv-paste" rows="4"'
        + ' placeholder="alice@example.com&#10;Bob Smith &lt;bob@example.com&gt;&#10;carol.jones@company.com"></textarea>' +
        '<div class="mt-1 d-flex gap-2 align-items-center flex-wrap">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="inv-parse-btn">Parse &darr;</button>' +
          '<label class="btn btn-sm btn-outline-secondary mb-0" for="inv-csv">Upload CSV</label>' +
          '<input type="file" id="inv-csv" accept=".csv,text/csv" class="visually-hidden">' +
          '<span class="form-text ms-1">CSV columns: <code>email</code>, <code>firstName</code> (opt.), <code>lastName</code> (opt.)</span>' +
        '</div>' +
      '</div>' +
      // ── Table header
      '<div class="d-flex gap-1 mb-1 small text-muted text-uppercase" style="font-size:.68rem;font-weight:600;padding:0 .1rem">' +
        '<span style="flex:1.2">First name</span>' +
        '<span style="flex:1.2">Last name</span>' +
        '<span style="flex:2">Email *</span>' +
        '<span style="width:1.8rem"></span>' +
      '</div>' +
      // ── Rows container
      '<div id="inv-rows" class="mb-2"></div>' +
      // ── Actions
      '<div class="d-flex gap-2 align-items-center flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="inv-add-btn">+ Add row</button>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" id="inv-preview-btn">Preview Email</button>' +
        '<button type="button" class="btn btn-sm btn-success" id="inv-send-btn">Send Invites</button>' +
        '<span class="text-muted small" id="inv-count-lbl"></span>' +
      '</div>' +
      '<div id="inv-preview-status" class="mt-1 small text-muted">Preview required before sending.</div>' +
      '<div id="inv-preview-panel" class="mt-2 d-none">' +
        '<div class="card border">' +
          '<div class="card-header bg-light small fw-semibold">Email Preview</div>' +
          '<div class="card-body">' +
            '<div class="small text-muted">Subject</div>' +
            '<div id="inv-preview-subject" class="fw-semibold mb-2"></div>' +
            '<ul class="nav nav-tabs mb-2" role="tablist">' +
              '<li class="nav-item"><button class="nav-link active" id="inv-prev-tab-html" type="button">HTML</button></li>' +
              '<li class="nav-item"><button class="nav-link" id="inv-prev-tab-text" type="button">Text</button></li>' +
            '</ul>' +
            '<div id="inv-prev-html-wrap"><iframe id="inv-preview-html" style="width:100%;height:300px;border:1px solid #dee2e6;border-radius:.375rem;background:#fff"></iframe></div>' +
            '<pre id="inv-preview-text" class="json-out d-none" style="height:300px"></pre>' +
            '<div class="form-check mt-2">' +
              '<input class="form-check-input" type="checkbox" id="inv-preview-confirm">' +
              '<label class="form-check-label small" for="inv-preview-confirm">I reviewed this preview and confirm sending this email.</label>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="inv-form-status" class="mt-2 small"></div>' +
      '</div>'
    );
  }

  function inviteListHtml(slug: string): string {
    void slug;
    return (
      '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
        '<input type="search" class="form-control form-control-sm" id="inv-search" placeholder="Search email / name…" style="max-width:260px" autocomplete="off">' +
        '<label class="form-label mb-0 small fw-semibold visually-hidden" for="inv-filter">Filter status:</label>' +
        '<select class="form-select form-select-sm" id="inv-filter" style="width:auto">' +
          '<option value="">All statuses</option>' +
          '<option value="sent" selected>Pending (sent)</option>' +
          '<option value="accepted">Accepted</option>' +
          '<option value="declined">Declined</option>' +
          '<option value="expired">Expired</option>' +
          '<option value="revoked">Revoked</option>' +
        '</select>' +
        '<button class="btn btn-sm btn-outline-secondary ms-auto" id="inv-list-refresh">&circlearrowright; Refresh</button>' +
      '</div>' +
      '<div id="inv-list-body">' + spinner() + '</div>' +
      '<div id="inv-list-pager" class="mt-2"></div>'
    );
  }

  function adminCapWord(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  }

  function parseAdminInviteText(raw: string): { valid: AdminInviteEntry[]; skipped: number } {
    const results: AdminInviteEntry[] = [];
    let skipped = 0;
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // "First Last" <email>  or  First Last <email>
      const angleBracket = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
      if (angleBracket) {
        const namePart = angleBracket[1].trim();
        const email = angleBracket[2].trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
        const entry: AdminInviteEntry = { email };
        if (namePart) {
          const parts = namePart.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) { entry.firstName = parts[0]; entry.lastName = parts.slice(1).join(" "); }
          else if (parts.length === 1) { entry.firstName = parts[0]; }
        }
        results.push(entry);
        continue;
      }
      // CSV: three comma-separated values where last looks like email
      const csv = line.split(",").map((s) => s.trim());
      if (csv.length === 3 && csv[2].includes("@") && !csv[2].includes(" ")) {
        const email = csv[2].toLowerCase();
        if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
        results.push({ firstName: csv[0] || undefined, lastName: csv[1] || undefined, email });
        continue;
      }
      // Plain email(s) separated by commas/semicolons
      for (const atom of line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
        if (!atom.includes("@")) continue;
        const email = atom.toLowerCase();
        if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
        const entry: AdminInviteEntry = { email };
        const local = email.split("@")[0];
        const dotParts = local.split(".").filter(Boolean);
        if (dotParts.length >= 2) {
          entry.firstName = adminCapWord(dotParts[0]);
          entry.lastName = adminCapWord(dotParts.slice(1).join(" "));
        }
        results.push(entry);
      }
    }
    const seen = new Set<string>();
    const valid = results.filter((e) => {
      if (seen.has(e.email)) return false;
      seen.add(e.email);
      return true;
    });
    return { valid, skipped };
  }

  const _emailValidator = z.email();
  const EMAIL_REGEX = { test: (s: string) => _emailValidator.safeParse(s).success };

  function parseAdminCsv(text: string): { valid: AdminInviteEntry[]; skipped: number } {
    // Strip UTF-8 BOM that Excel adds to CSV exports.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { valid: [], skipped: 0 };
    // Detect header row: first line with no '@' and contains commas
    let dataStart = 0;
    const header = lines[0].toLowerCase();
    const colEmail = header.includes("email") ? header.split(",").findIndex((c) => c.includes("email")) : -1;
    const colFirst = header.split(",").findIndex((c) => c.includes("first"));
    const colLast  = header.split(",").findIndex((c) => c.includes("last"));
    if (colEmail !== -1) { dataStart = 1; } // has header
    const valid: AdminInviteEntry[] = [];
    let skipped = 0;
    for (let i = dataStart; i < lines.length; i++) {
      const parts = lines[i].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      if (colEmail !== -1) {
        const email = parts[colEmail]?.trim().toLowerCase() ?? "";
        if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
        const entry: AdminInviteEntry = { email };
        if (colFirst !== -1) { entry.firstName = parts[colFirst] || undefined; }
        if (colLast  !== -1) { entry.lastName  = parts[colLast]  || undefined; }
        if (colFirst === -1 && colLast === -1) {
          const local = email.split("@")[0];
          const dotParts = local.split(".").filter(Boolean);
          if (dotParts.length >= 2) {
            entry.firstName = adminCapWord(dotParts[0]);
            entry.lastName  = adminCapWord(dotParts.slice(1).join(" "));
          }
        }
        valid.push(entry);
      } else {
        // No header: treat as plain text
        const parsed = parseAdminInviteText(lines[i]);
        valid.push(...parsed.valid);
        skipped += parsed.skipped;
      }
    }
    return { valid, skipped };
  }

  // ── Admin invite row management ──────────────────────────────────────────────

  const MAX_ADMIN_INVITES = 500;
  /** Show at most this many rows in the DOM when a large CSV is imported. */
  const INVITE_BULK_THRESHOLD = 10;
  /** Entries per POST when chunking a large invite list across multiple requests. */
  // D1/SQLite hard-limits bind variables per statement to 999.
  // The pre-check queries bind up to N+2 variables, so keep chunks ≤ 900.
  const INVITE_CHUNK_SIZE = 900;

  let _invitePreviewState: {
    token: string;
    digest: string;
    expiresAt: string;
    /** SHA-256 hex digest of the full invite list, returned by the preview endpoint.
     *  Sent with every bulk chunk so the preview token validates against the full list. */
    inviteDigest: string;
  } | null = null;
  /** In-memory store for large CSV imports (> INVITE_BULK_THRESHOLD entries). */
  let _adminInviteEntries: AdminInviteEntry[] = [];
  function syncInviteCount(): void {
    const lbl = q("#inv-count-lbl");
    if (!lbl) return;
    const count = _adminInviteEntries.length > 0
      ? _adminInviteEntries.length
      : document.querySelectorAll("#inv-rows .inv-row").length;
    lbl.textContent = count > 0 ? `${count.toLocaleString()} row${count !== 1 ? "s" : ""}` : "";
  }

  function collectAdminInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
    if (_adminInviteEntries.length > 0) return _adminInviteEntries;
    const container = q("#inv-rows");
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(".inv-row"))
      .map((row) => ({
        email: (row.querySelector<HTMLInputElement>("[data-inv-email]")?.value ?? "").trim(),
        firstName: (row.querySelector<HTMLInputElement>("[data-inv-first]")?.value ?? "").trim() || undefined,
        lastName: (row.querySelector<HTMLInputElement>("[data-inv-last]")?.value ?? "").trim() || undefined,
      }))
      .filter((item) => item.email);
  }

  function renderAdminBulkSummary(entries: AdminInviteEntry[]): void {
    const container = q("#inv-rows");
    if (!container) return;
    const preview = entries.slice(0, INVITE_BULK_THRESHOLD);
    const more = entries.length - preview.length;
    const rows = preview
      .map((e) => {
        return `<tr><td class="small">${esc(e.firstName || "—")}</td><td class="small">${esc(e.lastName || "—")}</td><td class="small mono">${esc(e.email)}</td></tr>`;
      })
      .join("");
    container.innerHTML =
      `<div class="d-flex align-items-center gap-2 rounded border px-3 py-2 mb-2 small bg-light">` +
      `<span><strong>${entries.length.toLocaleString()}</strong> invites loaded from CSV</span>` +
      `<button type="button" class="btn btn-sm btn-link p-0 text-danger ms-auto" id="inv-clear-bulk">× Clear</button>` +
      `</div>` +
      `<table class="table table-sm mb-1"><thead><tr><th class="small">First name</th><th class="small">Last name</th><th class="small">Email</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      (more > 0 ? `<div class="small text-muted ps-1">\u2026and ${more.toLocaleString()} more</div>` : "");
    container.querySelector("#inv-clear-bulk")?.addEventListener("click", () => {
      clearAdminBulkImport();
      invalidateInvitePreview();
    });
  }

  function clearAdminBulkImport(): void {
    _adminInviteEntries = [];
    const container = q("#inv-rows");
    if (container) container.innerHTML = "";
    addAdminInviteRow();
    syncInviteCount();
  }

  function invitePreviewDigest(invites: Array<{ email: string; firstName?: string; lastName?: string; sourceType?: string }>): string {
    const normalized = invites.map((item) => ({
      email: item.email.trim().toLowerCase(),
      firstName: (item.firstName ?? "").trim(),
      lastName: (item.lastName ?? "").trim(),
      sourceType: (item.sourceType ?? "").trim(),
    }));
    return JSON.stringify(normalized);
  }

  function setInvitePreviewTab(tab: "html" | "text"): void {
    const htmlBtn = q<HTMLButtonElement>("#inv-prev-tab-html");
    const textBtn = q<HTMLButtonElement>("#inv-prev-tab-text");
    const htmlWrap = q("#inv-prev-html-wrap");
    const textWrap = q("#inv-preview-text");
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

  function invalidateInvitePreview(message = "Preview required before sending."): void {
    _invitePreviewState = null;
    const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");
    if (previewConfirm) previewConfirm.checked = false;

    const previewPanel = q("#inv-preview-panel");
    hide(previewPanel);

    const statusEl = q("#inv-preview-status");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = "mt-1 small text-muted";
    }
  }

  function makeAdminInviteRow(entry?: AdminInviteEntry): HTMLElement {
    const div = document.createElement("div");
    div.className = "inv-row d-flex gap-1 mb-1 align-items-center";
    div.innerHTML =
      `<input class="form-control form-control-sm" style="flex:1.2" type="text"
        placeholder="First (opt.)" data-inv-first autocomplete="off"
        value="${esc(entry?.firstName ?? "")}">` +
      `<input class="form-control form-control-sm" style="flex:1.2" type="text"
        placeholder="Last (opt.)" data-inv-last autocomplete="off"
        value="${esc(entry?.lastName ?? "")}">` +
      `<input class="form-control form-control-sm" style="flex:2" type="email"
        placeholder="email@example.com" data-inv-email autocomplete="off"
        value="${esc(entry?.email ?? "")}">` +
      '<button type="button" class="btn btn-sm btn-outline-danger p-0 px-1 inv-remove-btn' +
      '" title="Remove row" style="flex:none;height:1.75rem;line-height:1">&times;</button>';
    div.querySelector<HTMLButtonElement>(".inv-remove-btn")?.addEventListener("click", () => {
      div.remove();
      syncInviteCount();
    });
    // Inline paste detection in the email field
    div.querySelector<HTMLInputElement>("[data-inv-email]")?.addEventListener("paste", (e) => {
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
      e.preventDefault();
      const { valid: entries, skipped: _s } = parseAdminInviteText(pasted);
      if (!entries.length) return;
      const firstEl = div.querySelector<HTMLInputElement>("[data-inv-first]");
      const lastEl  = div.querySelector<HTMLInputElement>("[data-inv-last]");
      const emailEl = div.querySelector<HTMLInputElement>("[data-inv-email]");
      if (firstEl) firstEl.value = entries[0].firstName ?? "";
      if (lastEl)  lastEl.value  = entries[0].lastName  ?? "";
      if (emailEl) emailEl.value = entries[0].email;
      for (const extra of entries.slice(1)) addAdminInviteRow(extra);
      syncInviteCount();
    });
    return div;
  }

  function addAdminInviteRow(entry?: AdminInviteEntry): void {
    const container = q("#inv-rows");
    if (!container) return;
    if (container.querySelectorAll(".inv-row").length >= MAX_ADMIN_INVITES) return;
    container.appendChild(makeAdminInviteRow(entry));
    syncInviteCount();
    invalidateInvitePreview();
  }

  function addParsedAdminEntries(entries: AdminInviteEntry[]): void {
    if (entries.length > INVITE_BULK_THRESHOLD) {
      _adminInviteEntries = entries;
      renderAdminBulkSummary(entries);
      syncInviteCount();
      return;
    }
    const container = q("#inv-rows");
    if (!container) return;
    // Fill existing empty rows first
    const existingRows = Array.from(container.querySelectorAll<HTMLElement>(".inv-row"));
    let idx = 0;
    for (const row of existingRows) {
      if (idx >= entries.length) break;
      const emailEl = row.querySelector<HTMLInputElement>("[data-inv-email]");
      if (emailEl && !emailEl.value.trim()) {
        const firstEl = row.querySelector<HTMLInputElement>("[data-inv-first]");
        const lastEl  = row.querySelector<HTMLInputElement>("[data-inv-last]");
        if (firstEl) firstEl.value = entries[idx].firstName ?? "";
        if (lastEl)  lastEl.value  = entries[idx].lastName  ?? "";
        emailEl.value = entries[idx].email;
        idx++;
      }
    }
    for (; idx < entries.length; idx++) addAdminInviteRow(entries[idx]);
    syncInviteCount();
  }

  function wireInviteForm(slug: string): void {
    _invitePreviewState = null;

    // Start with one empty row
    addAdminInviteRow();

    const rowContainer = q("#inv-rows");
    rowContainer?.addEventListener("input", () => invalidateInvitePreview());

    q("#inv-prev-tab-html")?.addEventListener("click", () => setInvitePreviewTab("html"));
    q("#inv-prev-tab-text")?.addEventListener("click", () => setInvitePreviewTab("text"));
    q<HTMLInputElement>("#inv-preview-confirm")?.addEventListener("change", (event) => {
      const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
      if (!sendBtn) return;
      const checked = (event.target as HTMLInputElement).checked;
      sendBtn.disabled = !checked || !_invitePreviewState;
    });

    // Parse button
    q("#inv-parse-btn")?.addEventListener("click", () => {
      const text = q<HTMLTextAreaElement>("#inv-paste")?.value ?? "";
      const { valid, skipped } = parseAdminInviteText(text);
      if (!valid.length) { toast(skipped > 0 ? `No valid email addresses found (${skipped} invalid)` : "No valid email addresses found in the pasted text", "error"); return; }
      addParsedAdminEntries(valid);
      const ta = q<HTMLTextAreaElement>("#inv-paste");
      if (ta) ta.value = "";
      invalidateInvitePreview();
      const skipMsg = skipped > 0 ? ` (${skipped} skipped — invalid email)` : "";
      toast(`Parsed ${valid.length} entr${valid.length !== 1 ? "ies" : "y"}${skipMsg}`, skipped > 0 ? "info" : "success");
    });

    // Auto-parse on paste into the textarea
    q<HTMLTextAreaElement>("#inv-paste")?.addEventListener("paste", () => {
      setTimeout(() => {
        const ta = q<HTMLTextAreaElement>("#inv-paste");
        if (!ta?.value.trim()) return;
        const { valid, skipped } = parseAdminInviteText(ta.value);
        if (!valid.length) return;
        addParsedAdminEntries(valid);
        if (skipped > 0) toast(`${skipped} address${skipped !== 1 ? "es" : ""} skipped — invalid email`, "info");
        ta.value = "";
        syncInviteCount();
        invalidateInvitePreview();
      }, 0);
    });

    // CSV file upload
    q<HTMLInputElement>("#inv-csv")?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string ?? "";
        const { valid, skipped } = parseAdminCsv(text);
        if (!valid.length) { toast("No valid rows found in CSV", "error"); return; }
        addParsedAdminEntries(valid);
        invalidateInvitePreview();
        const skipMsg = skipped > 0 ? ` (${skipped} row${skipped !== 1 ? "s" : ""} skipped — invalid email)` : "";
        toast(`Imported ${valid.length} row${valid.length !== 1 ? "s" : ""} from CSV${skipMsg}`, skipped > 0 ? "info" : "success");
        (e.target as HTMLInputElement).value = "";
      };
      reader.readAsText(file);
    });

    // Add row button
    q("#inv-add-btn")?.addEventListener("click", () => addAdminInviteRow());

    // Preview button
    q("#inv-preview-btn")?.addEventListener("click", () => void doAdminInvitePreview(slug));

    // Send button
    q("#inv-send-btn")?.addEventListener("click", () => void doAdminInvite(slug));
  }

  async function doAdminInvitePreview(slug: string): Promise<void> {
    const invites = collectAdminInvites();
    const statusEl = q("#inv-preview-status");
    const btn = q<HTMLButtonElement>("#inv-preview-btn");
    const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
    const previewPanel = q("#inv-preview-panel");
    const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");

    if (!invites.length) {
      if (statusEl) {
        statusEl.textContent = "Add at least one invitee before previewing.";
        statusEl.className = "mt-1 small text-danger";
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Rendering...";
    }
    if (sendBtn) sendBtn.disabled = true;
    if (previewConfirm) previewConfirm.checked = false;
    hide(previewPanel);
    if (statusEl) {
      statusEl.textContent = "Rendering preview...";
      statusEl.className = "mt-1 small text-muted";
    }

    try {
      const result = await api<{
        previewToken: string;
        previewExpiresAt: string;
        recipientCount: number;
        inviteDigest: string;
        subject: string;
        html: string;
        text: string;
      }>(`/api/v1/admin/events/${slug}/invites/attendees/preview`, {
        method: "POST",
        body: JSON.stringify({ invites }),
      });

      _invitePreviewState = {
        token: result.previewToken,
        digest: invitePreviewDigest(invites),
        expiresAt: result.previewExpiresAt,
        inviteDigest: result.inviteDigest,
      };

      const previewSubject = q("#inv-preview-subject");
      const previewHtml = q<HTMLIFrameElement>("#inv-preview-html");
      const previewText = q<HTMLElement>("#inv-preview-text");
      if (previewSubject) previewSubject.textContent = result.subject;
      if (previewHtml) previewHtml.srcdoc = result.html;
      if (previewText) previewText.textContent = result.text;
      setInvitePreviewTab("html");
      show(previewPanel);

      // Explicit confirmation is required after preview is rendered.
      if (sendBtn) sendBtn.disabled = true;
      if (statusEl) {
        const expiresAt = new Date(result.previewExpiresAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
        statusEl.textContent = `Preview ready for ${result.recipientCount} invitee(s). Review it and confirm before sending. Expires at ${expiresAt}.`;
        statusEl.className = "mt-1 small text-success";
      }
      toast("Invite preview rendered. Confirm after reviewing to enable send.", "success");
    } catch (err) {
      _invitePreviewState = null;
      hide(previewPanel);
      if (statusEl) {
        statusEl.textContent = (err as Error).message;
        statusEl.className = "mt-1 small text-danger";
      }
      toast((err as Error).message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Preview Email";
      }
    }
  }

  async function doAdminInvite(slug: string): Promise<void> {
    const statusEl = q("#inv-form-status");

    const invites = collectAdminInvites();

    if (!invites.length) {
      if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
      return;
    }

    const currentDigest = invitePreviewDigest(invites);
    if (!_invitePreviewState || _invitePreviewState.digest !== currentDigest) {
      if (statusEl) {
        statusEl.textContent = "Preview required. Render a fresh preview before sending.";
        statusEl.className = "mt-2 small text-danger";
      }
      invalidateInvitePreview();
      return;
    }

    const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");
    if (!previewConfirm?.checked) {
      if (statusEl) {
        statusEl.textContent = "Review and confirm the preview before sending.";
        statusEl.className = "mt-2 small text-danger";
      }
      return;
    }

    const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending..."; }
    if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

    try {
      // Split large lists into chunks so each Worker request stays within the
      // 30-second wall-clock limit.  All chunks share the same previewToken
      // (issued for the full list) and include the full-list inviteDigest so
      // the backend can validate the token against the complete list rather
      // than just the current chunk.
      const chunks: typeof invites[] = [];
      for (let i = 0; i < invites.length; i += INVITE_CHUNK_SIZE) {
        chunks.push(invites.slice(i, i + INVITE_CHUNK_SIZE));
      }

      let totalCreated = 0;
      let totalEndorsed = 0;
      let totalSkipped = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1 && statusEl) {
          statusEl.textContent = `Sending batch ${i + 1} of ${chunks.length}…`;
          statusEl.className = "mt-2 small text-muted";
        }
        const payload: Record<string, unknown> = {
          invites: chunks[i],
          previewToken: _invitePreviewState.token,
        };
        if (chunks.length > 1) {
          payload.inviteDigest = _invitePreviewState.inviteDigest;
        }
        const r = await api<{ created?: unknown[]; endorsed?: unknown[]; skipped?: unknown[] }>(
          `/api/v1/admin/events/${slug}/invites/attendees/bulk`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        totalCreated  += r.created?.length  ?? 0;
        totalEndorsed += r.endorsed?.length ?? 0;
        totalSkipped  += r.skipped?.length  ?? 0;
      }

      const parts = [`✓ ${totalCreated} invitation${totalCreated !== 1 ? "s" : ""} queued`];
      if (totalEndorsed) parts.push(`${totalEndorsed} already invited`);
      if (totalSkipped)  parts.push(`${totalSkipped} skipped`);
      toast(parts.join(" · "), "success");

      _invitePreviewState = null;
      clearAdminBulkImport();
      invalidateInvitePreview();
      if (statusEl) { statusEl.textContent = parts.join(" · "); statusEl.className = "mt-2 small text-success"; }
    } catch (err) {
      toast((err as Error).message, "error");
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send Invites"; }
    }
  }

  // ── Invite badge (separate from email outbox badge colours) ─────────────────────

  function inviteBadge(status: string): string {
    const map: Record<string, [string, string]> = {
      sent:     ["info",      "Pending"],
      accepted: ["success",   "Accepted"],
      declined: ["danger",    "Declined"],
      expired:  ["secondary", "Expired"],
      revoked:  ["warning",   "Revoked"],
    };
    const [color, label] = map[status] ?? ["secondary", status];
    return `<span class="badge text-bg-${color}">${esc(label)}</span>`;
  }

  async function loadEventInvites(slug: string, statusFilter?: string): Promise<void> {
    const body = q("#inv-list-body");
    const pager = q("#inv-list-pager");
    if (!body) return;
    body.innerHTML = spinner();
    if (pager) pager.innerHTML = "";

    // Wire filter controls once
    const filterSel = q<HTMLSelectElement>("#inv-filter");
    const searchInput = q<HTMLInputElement>("#inv-search");
    const refreshBtn = q<HTMLButtonElement>("#inv-list-refresh");

    const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");
    let offset = 0;
    let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

    const doLoad = async (): Promise<void> => {
      body.innerHTML = spinner();
      const filter = getFilter();
      const query = new URLSearchParams({ type: "attendee", limit: String(pageSize), offset: String(offset) });
      if (filter) query.set("status", filter);
      const searchVal = (searchInput?.value ?? "").trim();
      if (searchVal) query.set("q", searchVal);
      const url = `/api/v1/admin/events/${slug}/invites?${query.toString()}`;
      try {
        const d = await api<{ invites: InviteRecord[]; page?: { limit: number; offset: number; hasMore: boolean; total: number } }>(url);
        const invites = d.invites ?? [];
        body.innerHTML = tbl(
          ["Invitee Email", "Invitee Name", "Invited By", "Type", "Status", "Source", "Sent", "Declined", "Decline Reason", "Note"],
          invites.map((i) => {
            const name = [i.invitee_first_name, i.invitee_last_name].filter(Boolean).join(" ") || "—";
            const inviterName = [i.inviter_first_name, i.inviter_last_name].filter(Boolean).join(" ");
            const inviterDisplay = i.inviter_email
              ? (inviterName
                  ? `${esc(inviterName)}<br><span class="mono text-muted" style="font-size:.75rem">${esc(i.inviter_email)}</span>`
                  : `<span class="mono">${esc(i.inviter_email)}</span>`)
              : '<span class="text-muted fst-italic">Admin</span>';
            const reasonCode = i.decline_reason_code ?? "";
            const reasonNote = i.decline_reason_note ?? "";
            const unsubIcon  = i.unsubscribe_future ? " \uD83D\uDEAB" : "";
            return (
              `<tr><td class="mono" style="font-size:.8rem">${esc(i.invitee_email)}</td>` +
              `<td>${esc(name)}</td>` +
              `<td style="font-size:.82rem">${inviterDisplay}</td>` +
              `<td class="text-muted small">${esc(i.invite_type)}</td>` +
              `<td>${inviteBadge(i.status)}</td>` +
              `<td class="text-muted small">${esc(i.source_type ?? "—")}</td>` +
              `<td class="mono">${fmt(i.created_at)}</td>` +
              `<td class="mono">${i.declined_at ? fmt(i.declined_at) : "—"}</td>` +
              `<td class="small">${reasonCode ? esc(reasonCode) + unsubIcon : "—"}</td>` +
              `<td class="small text-muted" style="max-width:200px;overflow-wrap:break-word">${reasonNote ? esc(reasonNote) : "—"}</td></tr>`
            );
          }),
          "No invites found matching the current filter",
        );

        const pageOffset = d.page?.offset ?? offset;
        const pageLimit = d.page?.limit ?? pageSize;
        const hasMore = d.page?.hasMore ?? false;
        const pageTotal = d.page?.total ?? 0;
        const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

        if (pager) {
          pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, invites.length, pageTotal);
          pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
            offset = Math.max(0, pageOffset - pageLimit);
            void doLoad();
          });
          pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
            offset = pageOffset + pageLimit;
            void doLoad();
          });
          pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const page = Number(btn.dataset.pageJump || "1");
              if (!Number.isFinite(page) || page < 1) return;
              offset = (page - 1) * pageLimit;
              void doLoad();
            });
          });
          pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
            const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
            if (!Number.isFinite(nextSize) || nextSize < 1) return;
            pageSize = nextSize;
            offset = 0;
            void doLoad();
          });
        }
      } catch (err) {
        body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
        if (pager) pager.innerHTML = "";
      }
    };

    // Only wire once (check data attribute)
    const bodyEl = body as HTMLElement;
    if (!bodyEl.dataset.invListWired) {
      bodyEl.dataset.invListWired = "1";
      searchInput?.addEventListener("input", () => { offset = 0; void doLoad(); });
      filterSel?.addEventListener("change", () => { offset = 0; void doLoad(); });
      refreshBtn?.addEventListener("click", () => { offset = 0; void doLoad(); });
    }

    await doLoad();
  }


  return { inviteFormHtml, inviteListHtml, inviteBadge, parseAdminInviteText, parseAdminCsv, wireInviteForm, loadEventInvites };
}
