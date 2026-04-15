import { useState, useRef } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { AdminInviteEntry, InviteRecord } from "../../../types";
import { parseContactText } from "../../../../shared/invite-parser";

export type InviteType = "attendee" | "speaker";

// ─── Invite form ──────────────────────────────────────────────────────────────

interface ParsedInvites { valid: AdminInviteEntry[]; skipped: number }

function parseText(raw: string): ParsedInvites {
  const lineCount = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean).length;
  const contacts = parseContactText(raw);
  const valid: AdminInviteEntry[] = contacts.map((c) => ({
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
  }));
  return { valid, skipped: Math.max(0, lineCount - valid.length) };
}

interface InviteRow extends AdminInviteEntry { _key: number }

function InviteForm({ slug, inviteType }: { slug: string; inviteType: InviteType }) {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<InviteRow[]>([{ _key: 0, email: "", firstName: "", lastName: "" }]);
  const [keyCounter, setKeyCounter] = useState(1);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [inviteDigest, setInviteDigest] = useState<string | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [previewStatus, setPreviewStatus] = useState(
    inviteType === "attendee" ? "Preview required before sending." : "",
  );
  const [sendStatus, setSendStatus] = useState("");
  const [sending, setSending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const typeLabel = inviteType === "attendee" ? "attendee" : "speaker";

  function handleParse() {
    const { valid, skipped } = parseText(pasteText);
    if (!valid.length) { toast("No valid emails found" + (skipped ? ` (${skipped} skipped)` : ""), "error"); return; }
    setRows(valid.map((e, i) => ({ ...e, _key: keyCounter + i })));
    setKeyCounter((k) => k + valid.length);
    setPasteText("");
    // Reset preview state when invite list changes
    setPreview(null);
    setPreviewToken(null);
    setInviteDigest(null);
    setPreviewConfirmed(false);
    if (inviteType === "attendee") setPreviewStatus("Preview required before sending.");
    toast(`Parsed ${valid.length} invite${valid.length !== 1 ? "s" : ""}${skipped ? `, ${skipped} skipped` : ""}`, "success");
  }

  function handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const { valid, skipped } = parseText(text);
      if (!valid.length) { toast("No valid emails found in file" + (skipped ? ` (${skipped} rows skipped)` : ""), "error"); return; }
      setRows(valid.map((entry, i) => ({ ...entry, _key: keyCounter + i })));
      setKeyCounter((k) => k + valid.length);
      setPreview(null);
      setPreviewToken(null);
      setInviteDigest(null);
      setPreviewConfirmed(false);
      if (inviteType === "attendee") setPreviewStatus("Preview required before sending.");
      toast(`Loaded ${valid.length} invite${valid.length !== 1 ? "s" : ""} from file${skipped ? `, ${skipped} skipped` : ""}`, "success");
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addRow() {
    setRows((prev) => [...prev, { _key: keyCounter, email: "", firstName: "", lastName: "" }]);
    setKeyCounter((k) => k + 1);
  }

  function updateRow(key: number, patch: Partial<InviteRow>) {
    setRows((prev) => prev.map((r) => r._key === key ? { ...r, ...patch } : r));
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r._key !== key));
  }

  const validRows = rows.filter((r) => r.email.trim().includes("@"));

  async function handlePreview() {
    if (!validRows.length) { toast("No valid emails to preview", "error"); return; }
    setPreviewStatus("Generating preview…");
    setPreview(null);
    setPreviewConfirmed(false);
    setPreviewToken(null);
    setInviteDigest(null);
    try {
      const invites = validRows.map(({ email, firstName, lastName }) => ({ email, firstName, lastName }));
      const res = await api<{ subject: string; html: string; text: string; previewToken: string; inviteDigest: string }>(
        `/api/v1/admin/events/${slug}/invites/attendees/preview`,
        { method: "POST", body: JSON.stringify({ invites }) },
      );
      setPreview(res);
      setPreviewToken(res.previewToken);
      setInviteDigest(res.inviteDigest);
      setPreviewStatus("Review and confirm below.");
      if (iframeRef.current) {
        iframeRef.current.srcdoc = res.html;
      }
    } catch (e) {
      const msg = (e as Error).message;
      setPreviewStatus(msg);
      toast(msg, "error");
    }
  }

  async function handleSend() {
    if (inviteType === "attendee" && !previewConfirmed) {
      toast("Review the preview and tick the confirmation checkbox first.", "error");
      return;
    }
    if (!validRows.length) return;
    setSending(true);
    setSendStatus("Sending…");
    try {
      const invites = validRows.map(({ email, firstName, lastName }) => ({ email, firstName, lastName }));
      const CHUNK = 500;
      let total = 0;
      if (inviteType === "attendee") {
        for (let i = 0; i < invites.length; i += CHUNK) {
          const chunk = invites.slice(i, i + CHUNK);
          await api(`/api/v1/admin/events/${slug}/invites/attendees/bulk`, {
            method: "POST",
            body: JSON.stringify({ previewToken, inviteDigest, invites: chunk }),
          });
          total += chunk.length;
          setSendStatus(`Sent ${total} of ${invites.length}…`);
        }
      } else {
        for (let i = 0; i < invites.length; i += CHUNK) {
          const chunk = invites.slice(i, i + CHUNK);
          await api(`/api/v1/admin/events/${slug}/invites/speakers/bulk`, {
            method: "POST",
            body: JSON.stringify({ invites: chunk }),
          });
          total += chunk.length;
          setSendStatus(`Sent ${total} of ${invites.length}…`);
        }
      }
      toast(`Sent ${total} ${typeLabel} invites`, "success");
      setSendStatus(`✓ Sent ${total} invites`);
      setRows([{ _key: keyCounter, email: "", firstName: "", lastName: "" }]);
      setKeyCounter((k) => k + 1);
      setPreview(null);
      setPreviewToken(null);
      setInviteDigest(null);
      setPreviewConfirmed(false);
      if (inviteType === "attendee") setPreviewStatus("Preview required before sending.");
    } catch (e) {
      const msg = (e as Error).message;
      setSendStatus(msg);
      toast(msg, "error");
    } finally {
      setSending(false);
    }
  }

  const canSend = inviteType === "speaker" || previewConfirmed;

  return (
    <div>
      <div class="mb-3">
        <label class="form-label small fw-semibold">
          Paste emails &amp; names
          <span class="text-muted fw-normal"> — one per line; supports <code>Name &lt;email&gt;</code> or dotted addresses</span>
        </label>
        <textarea class="form-control form-control-sm" rows={4} value={pasteText} onInput={(e) => setPasteText((e.target as HTMLTextAreaElement).value)} placeholder={"alice@example.com\nBob Smith <bob@example.com>"} />
        <div class="mt-1 d-flex gap-2 align-items-center">
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={handleParse}>Parse ↓</button>
          <span class="text-muted small">or</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => fileRef.current?.click()}>Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" class="d-none" onChange={handleFileUpload} />
        </div>
      </div>

      {/* Row header */}
      <div class="d-flex gap-1 mb-1 small text-muted text-uppercase adm-invite-row-header">
        <span class="adm-invite-col-name">First name</span>
        <span class="adm-invite-col-name">Last name</span>
        <span class="adm-invite-col-email">Email *</span>
        <span class="adm-invite-col-action"></span>
      </div>

      {/* Rows */}
      <div class="mb-2">
        {rows.map((r) => (
          <div key={r._key} class="d-flex gap-1 align-items-center mb-1">
            <input class="form-control form-control-sm adm-invite-col-name" placeholder="First" value={r.firstName ?? ""} onInput={(e) => updateRow(r._key, { firstName: (e.target as HTMLInputElement).value })} />
            <input class="form-control form-control-sm adm-invite-col-name" placeholder="Last" value={r.lastName ?? ""} onInput={(e) => updateRow(r._key, { lastName: (e.target as HTMLInputElement).value })} />
            <input class="form-control form-control-sm adm-invite-col-email" placeholder="email@example.com" type="email" value={r.email} onInput={(e) => updateRow(r._key, { email: (e.target as HTMLInputElement).value })} required />
            <button type="button" class="btn btn-sm btn-outline-danger adm-invite-action-btn" onClick={() => removeRow(r._key)}>×</button>
          </div>
        ))}
      </div>

      <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={addRow}>+ Add row</button>
        {inviteType === "attendee" && (
          <button type="button" class="btn btn-sm btn-outline-primary" onClick={() => void handlePreview()}>Preview Email</button>
        )}
        <button type="button" class="btn btn-sm btn-success" onClick={() => void handleSend()} disabled={sending || !canSend}>
          Send {inviteType === "attendee" ? "Attendee" : "Speaker"} Invites
        </button>
        <span class="text-muted small">{validRows.length} valid</span>
      </div>
      {previewStatus && <div class="small text-muted">{previewStatus}</div>}
      {sendStatus && <div class={`mt-1 small ${sendStatus.startsWith("✓") ? "text-success" : "text-danger"}`}>{sendStatus}</div>}

      {preview && (
        <div class="card border mt-3">
          <div class="card-header bg-light small fw-semibold">Email Preview</div>
          <div class="card-body">
            <div class="small text-muted">Subject</div>
            <div class="fw-semibold mb-2">{preview.subject}</div>
            <iframe ref={iframeRef} sandbox="" class="adm-email-preview-frame" />
            <div class="form-check mt-2">
              <input class="form-check-input" type="checkbox" id="inv-confirm" checked={previewConfirmed} onChange={(e) => setPreviewConfirmed((e.target as HTMLInputElement).checked)} />
              <label class="form-check-label small" for="inv-confirm">I reviewed this preview and confirm sending this email.</label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invite list ──────────────────────────────────────────────────────────────

function InviteList({ slug, inviteType }: { slug: string; inviteType: InviteType }) {
  const [statusFilter, setStatusFilter] = useState("sent");
  const tableRef = useRef<ApiTableActions | null>(null);

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invite?")) return;
    try {
      await api(`/api/v1/admin/events/${slug}/invites/${id}/revoke`, { method: "POST", body: "{}" });
      toast("Invite revoked", "success");
      tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <ApiDataTable<InviteRecord>
      endpoint={`/api/v1/admin/events/${slug}/invites`}
      resolve={(d) => (d as { invites: InviteRecord[] }).invites}
      resolvePage={(d) => (d as { pagination: { total: number; hasMore: boolean } }).pagination}
      paginate
      searchPlaceholder="Search email / name…"
      params={{ type: inviteType, ...(statusFilter ? { status: statusFilter } : {}) }}
      actionsRef={tableRef}
      deps={[slug, inviteType, statusFilter]}
      toolbar={({ resetPage }) => (
        <select class="form-select form-select-sm adm-filter-select" value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); resetPage(); }}>
          <option value="">All statuses</option>
          <option value="sent">Pending (sent)</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      )}
      columns={[
        { header: "Email", cell: (inv) => inv.invitee_email },
        { header: "Name", cell: (inv) => [inv.invitee_first_name, inv.invitee_last_name].filter(Boolean).join(" ") || "—" },
        { header: "Status", cell: (inv) => <Badge status={inv.status} /> },
        { header: "Sent by", cell: (inv) => inv.inviter_email ?? inv.inviter_user_id ?? "—", className: "small text-muted" },
        { header: "Sent", cell: (inv) => fmt(inv.created_at), className: "mono small" },
        { header: "Accepted", cell: (inv) => inv.accepted_at ? fmt(inv.accepted_at) : "—", className: "mono small" },
        { header: "", cell: (inv) => (inv.status === "sent" || inv.status === "pending") ? <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(inv.id)}>Revoke</button> : null },
      ]}
      empty={`No ${inviteType} invites found`}
      rowKey={(inv) => inv.id}
    />
  );
}

// ─── Invites compositor ───────────────────────────────────────────────────────

export function Invites({ slug, inviteType = "attendee" }: { slug: string; inviteType?: InviteType }) {
  const [tab, setTab] = useState<"send" | "list">("send");
  const typeLabel = inviteType === "attendee" ? "Attendee" : "Speaker";

  return (
    <div>
      <Tabs
        items={[
          { key: "send", label: `Send ${typeLabel} Invites` },
          { key: "list", label: `${typeLabel} Invite List` },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "send" | "list")}
      />

      {tab === "send" && <InviteForm slug={slug} inviteType={inviteType} />}
      {tab === "list" && <InviteList slug={slug} inviteType={inviteType} />}
    </div>
  );
}
