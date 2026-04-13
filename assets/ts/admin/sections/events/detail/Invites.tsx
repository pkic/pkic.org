import { h, Fragment } from "preact";
import { useState, useRef } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useData } from "../../../../hooks/useData";
import { usePageState } from "../../../../hooks/usePageState";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { AdminInviteEntry, InviteRecord } from "../../../types";
import { parseContactText } from "../../../../shared/invite-parser";

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

function InviteForm({ slug }: { slug: string }) {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<InviteRow[]>([{ _key: 0, email: "", firstName: "", lastName: "" }]);
  const [keyCounter, setKeyCounter] = useState(1);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("Preview required before sending.");
  const [sendStatus, setSendStatus] = useState("");
  const [sending, setSending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function handleParse() {
    const { valid, skipped } = parseText(pasteText);
    if (!valid.length) { toast("No valid emails found" + (skipped ? ` (${skipped} skipped)` : ""), "error"); return; }
    setRows(valid.map((e, i) => ({ ...e, _key: keyCounter + i })));
    setKeyCounter((k) => k + valid.length);
    setPasteText("");
    toast(`Parsed ${valid.length} invite${valid.length !== 1 ? "s" : ""}${skipped ? `, ${skipped} skipped` : ""}`, "success");
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
    try {
      const res = await api<{ subject: string; html: string; text: string }>(
        `/api/v1/admin/events/${slug}/invites/preview`,
        { method: "POST", body: JSON.stringify({ invitees: validRows.slice(0, 1) }) },
      );
      setPreview(res);
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
    if (!previewConfirmed) { toast("Review the preview and tick the confirmation checkbox first.", "error"); return; }
    if (!validRows.length) return;
    setSending(true);
    setSendStatus("Sending…");
    try {
      const CHUNK = 50;
      const allRows = validRows.slice(0, 500);
      let total = 0;
      for (let i = 0; i < allRows.length; i += CHUNK) {
        const chunk = allRows.slice(i, i + CHUNK);
        await api(`/api/v1/admin/events/${slug}/invites`, {
          method: "POST",
          body: JSON.stringify({ invitees: chunk }),
        });
        total += chunk.length;
        setSendStatus(`Sent ${total} of ${allRows.length}…`);
      }
      toast(`Sent ${total} invites`, "success");
      setSendStatus(`✓ Sent ${total} invites`);
      setRows([{ _key: keyCounter, email: "", firstName: "", lastName: "" }]);
      setKeyCounter((k) => k + 1);
      setPreview(null);
      setPreviewConfirmed(false);
    } catch (e) {
      const msg = (e as Error).message;
      setSendStatus(msg);
      toast(msg, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div class="mb-3">
        <label class="form-label small fw-semibold">
          Paste emails &amp; names
          <span class="text-muted fw-normal"> — one per line; supports <code>Name &lt;email&gt;</code> or dotted addresses</span>
        </label>
        <textarea class="form-control form-control-sm" rows={4} value={pasteText} onInput={(e) => setPasteText((e.target as HTMLTextAreaElement).value)} placeholder={"alice@example.com\nBob Smith <bob@example.com>"} />
        <div class="mt-1">
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={handleParse}>Parse ↓</button>
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
        <button type="button" class="btn btn-sm btn-outline-primary" onClick={() => void handlePreview()}>Preview Email</button>
        <button type="button" class="btn btn-sm btn-success" onClick={() => void handleSend()} disabled={sending || !previewConfirmed}>Send Invites</button>
        <span class="text-muted small">{validRows.length} valid</span>
      </div>
      <div class="small text-muted">{previewStatus}</div>
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

interface InvitesResponse {
  invites: InviteRecord[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
}

function InviteList({ slug }: { slug: string }) {
  const { offset, pageSize, resetPage, pagerProps } = usePageState();
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("sent");

  const { data, loading, error, reload } = useData<InvitesResponse>(() => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (search) params.set("q", search);
    if (statusFilter) params.set("status", statusFilter);
    return api<InvitesResponse>(`/api/v1/admin/events/${slug}/invites?${params}`);
  }, [slug, search, statusFilter, offset, pageSize]);

  const invites = data?.invites ?? [];
  const total = data?.pagination?.total ?? 0;
  const hasMore = data?.pagination?.hasMore ?? false;

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invite?")) return;
    try {
      await api(`/api/v1/admin/events/${slug}/invites/${id}/revoke`, { method: "POST", body: "{}" });
      toast("Invite revoked", "success");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <input
          type="search"
          class="form-control form-control-sm adm-search-input"
          placeholder="Search email / name…"
          value={pendingSearch}
          onInput={(e) => setPendingSearch((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(pendingSearch); resetPage(); } }}
        />
        <select class="form-select form-select-sm adm-filter-select" value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); resetPage(); }}>
          <option value="">All statuses</option>
          <option value="sent">Pending (sent)</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>↺ Refresh</button>
      </div>

      {loading ? <Spinner /> : error ? <ErrorAlert error={error} /> : (
        <>
          <div class="table-responsive">
            <table class="table table-sm table-hover">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Sent by</th>
                  <th>Sent</th>
                  <th>Accepted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invites.length === 0 ? (
                  <tr><td colSpan={8} class="text-center text-muted fst-italic py-3">No invites found</td></tr>
                ) : invites.map((inv) => {
                  const name = [inv.invitee_first_name, inv.invitee_last_name].filter(Boolean).join(" ") || "—";
                  const inviter = inv.inviter_email ?? inv.inviter_user_id ?? "—";
                  return (
                    <tr key={inv.id}>
                      <td>{inv.invitee_email}</td>
                      <td>{name}</td>
                      <td><Badge status={inv.status} /></td>
                      <td class="small text-muted">{inv.invite_type}</td>
                      <td class="small text-muted">{inviter}</td>
                      <td class="mono small">{fmt(inv.created_at)}</td>
                      <td class="mono small">{inv.accepted_at ? fmt(inv.accepted_at) : "—"}</td>
                      <td>
                        {(inv.status === "sent" || inv.status === "pending") && (
                          <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(inv.id)}>Revoke</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager {...pagerProps(invites.length, total, hasMore)} />
        </>
      )}
    </div>
  );
}

// ─── Invites compositor ───────────────────────────────────────────────────────

export function Invites({ slug }: { slug: string }) {
  const [tab, setTab] = useState<"send" | "list">("send");

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        <li class="nav-item">
          <button class={`nav-link${tab === "send" ? " active" : ""}`} onClick={() => setTab("send")}>Send Invites</button>
        </li>
        <li class="nav-item">
          <button class={`nav-link${tab === "list" ? " active" : ""}`} onClick={() => setTab("list")}>Invite List</button>
        </li>
      </ul>

      {tab === "send" && <InviteForm slug={slug} />}
      {tab === "list" && <InviteList slug={slug} />}
    </div>
  );
}
