import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  eventInviteBulkResponseSchema,
  eventInvitePreviewResponseSchema,
} from "../../../shared/schemas/event-invite-bulk";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../shared/timezone";
import { parseContactText } from "../../shared/invite-parser";
import { postJson } from "../../shared/api-client";
import type { ToastType } from "../../shared/ui";

export type BulkInviteType = "attendee" | "speaker";

export function eventInviteEndpoints(basePath: string, type: BulkInviteType) {
  const resource = `${basePath}/${type}s`;
  return { preview: `${resource}/preview`, bulk: `${resource}/bulk` };
}

type InviteRow = { key: number; email: string; firstName?: string; lastName?: string };

function parseRows(raw: string): { rows: Omit<InviteRow, "key">[]; skipped: number } {
  const lines = raw.split(/\n+/).filter((line) => line.trim()).length;
  const rows = parseContactText(raw).map((contact) => ({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
  }));
  return { rows, skipped: Math.max(0, lines - rows.length) };
}

function previewReset(
  setPreview: (preview: z.infer<typeof eventInvitePreviewResponseSchema> | null) => void,
  setConfirmed: (confirmed: boolean) => void,
  setStatus: (status: string) => void,
) {
  setPreview(null);
  setConfirmed(false);
  setStatus("Preview required before sending.");
}

export function BulkInviteComposer({
  type,
  endpoints,
  event,
  notify,
  onSent,
}: {
  type: BulkInviteType;
  endpoints: { preview: string; bulk: string };
  event: { endsAt: string | null; timezone: string };
  notify: (message: string, type: ToastType) => void;
  onSent?: () => void | Promise<void>;
}) {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<InviteRow[]>([{ key: 0, email: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [preview, setPreview] = useState<z.infer<typeof eventInvitePreviewResponseSchema> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("Preview required before sending.");
  const [sendStatus, setSendStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;
  const label = type === "attendee" ? "attendee" : "speaker";
  const validRows = rows.filter((row) => row.email.trim().includes("@"));

  function resetPreview() {
    previewReset(setPreview, setConfirmed, setPreviewStatus);
  }

  function replaceRows(nextRows: Omit<InviteRow, "key">[], skipped: number) {
    if (nextRows.length === 0) {
      notify(`No valid emails found${skipped ? ` (${skipped} skipped)` : ""}`, "error");
      return;
    }
    setRows(nextRows.map((row, index) => ({ ...row, key: nextKey + index })));
    setNextKey((key) => key + nextRows.length);
    resetPreview();
    notify(
      `Loaded ${nextRows.length} invite${nextRows.length === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`,
      "success",
    );
  }

  function parsePastedRows() {
    const parsed = parseRows(pasteText);
    replaceRows(parsed.rows, parsed.skipped);
    if (parsed.rows.length) setPasteText("");
  }

  function loadFile(input: Event) {
    const file = (input.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRows(String(reader.result ?? ""));
      replaceRows(parsed.rows, parsed.skipped);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function updateRow(key: number, patch: Partial<InviteRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    resetPreview();
  }

  function requestBody() {
    return {
      invites: validRows.map(({ email, firstName, lastName }) => ({ email, firstName, lastName })),
      ...(expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {}),
    };
  }

  async function renderPreview() {
    if (validRows.length === 0) {
      notify("No valid emails to preview", "error");
      return;
    }
    setPreviewStatus("Generating preview…");
    setPreview(null);
    setConfirmed(false);
    try {
      const nextPreview = await postJson(endpoints.preview, requestBody(), eventInvitePreviewResponseSchema);
      setPreview(nextPreview);
      setPreviewStatus("Review and confirm below.");
    } catch (error) {
      const message = (error as Error).message;
      setPreviewStatus(message);
      notify(message, "error");
    }
  }

  async function send() {
    if (!preview || !confirmed) {
      notify("Review the preview and tick the confirmation checkbox first.", "error");
      return;
    }
    setSending(true);
    setSendStatus("Sending…");
    try {
      let sent = 0;
      const body = requestBody();
      for (const batch of preview.sendBatches) {
        const invites = body.invites.slice(batch.offset, batch.offset + batch.count);
        await postJson(
          endpoints.bulk,
          { ...body, invites, previewToken: batch.previewToken, inviteDigest: batch.inviteDigest },
          eventInviteBulkResponseSchema,
        );
        sent += invites.length;
        setSendStatus(`Sent ${sent} of ${body.invites.length}…`);
      }
      notify(`Sent ${sent} ${label} invites`, "success");
      setSendStatus(`Sent ${sent} invites`);
      setRows([{ key: nextKey, email: "" }]);
      setNextKey((key) => key + 1);
      resetPreview();
      await onSent?.();
    } catch (error) {
      const message = (error as Error).message;
      setSendStatus(message);
      notify(message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label={`Send ${label} invitations`} class="d-flex flex-column gap-3">
      <div>
        <label class="form-label small fw-semibold" for={`invite-paste-${type}`}>
          Paste emails and names <span class="text-muted fw-normal">— one per line</span>
        </label>
        <textarea
          id={`invite-paste-${type}`}
          class="form-control form-control-sm"
          rows={4}
          value={pasteText}
          onInput={(input) => setPasteText(input.currentTarget.value)}
          placeholder={"alice@example.com\nBob Smith <bob@example.com>"}
        />
        <div class="mt-1 d-flex gap-2 align-items-center">
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={parsePastedRows}>
            Parse
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => fileRef.current?.click()}>
            Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" class="d-none" onChange={loadFile} />
        </div>
      </div>
      <div>
        {rows.map((row, index) => (
          <div key={row.key} class="d-flex gap-1 align-items-center mb-1">
            <input
              class="form-control form-control-sm"
              aria-label={`${label} ${index + 1} first name`}
              placeholder="First"
              value={row.firstName ?? ""}
              onInput={(input) => updateRow(row.key, { firstName: input.currentTarget.value })}
            />
            <input
              class="form-control form-control-sm"
              aria-label={`${label} ${index + 1} last name`}
              placeholder="Last"
              value={row.lastName ?? ""}
              onInput={(input) => updateRow(row.key, { lastName: input.currentTarget.value })}
            />
            <input
              class="form-control form-control-sm"
              aria-label={`${label} ${index + 1} email address`}
              placeholder="email@example.com"
              type="email"
              value={row.email}
              onInput={(input) => updateRow(row.key, { email: input.currentTarget.value })}
            />
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              aria-label={`Remove ${label} row`}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary mt-1"
          onClick={() => {
            setRows((current) => [...current, { key: nextKey, email: "" }]);
            setNextKey((key) => key + 1);
          }}
        >
          Add row
        </button>
      </div>
      <div>
        <label class="form-label small fw-semibold" for={`invite-deadline-${type}`}>
          Invitation deadline
        </label>
        <input
          id={`invite-deadline-${type}`}
          class="form-control form-control-sm"
          type="datetime-local"
          value={expiresAt}
          max={latestExpiry}
          onInput={(input) => {
            setExpiresAt(input.currentTarget.value);
            resetPreview();
          }}
        />
        <div class="form-text">
          Leave blank to use the event start. A custom deadline cannot be later than the event end.
        </div>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">
        <button type="button" class="btn btn-sm btn-outline-primary" onClick={() => void renderPreview()}>
          Preview email
        </button>
        <button
          type="button"
          class="btn btn-sm btn-success"
          disabled={sending || !preview || !confirmed}
          onClick={() => void send()}
        >
          Send {type === "attendee" ? "attendee" : "speaker"} invites
        </button>
        <span class="small text-muted">{validRows.length} valid</span>
      </div>
      {previewStatus && <div class="small text-muted">{previewStatus}</div>}
      {sendStatus && (
        <div class="small" role="status">
          {sendStatus}
        </div>
      )}
      {preview && (
        <div class="card border">
          <div class="card-header small fw-semibold">Email preview</div>
          <div class="card-body">
            <div class="small text-muted">Subject</div>
            <div class="fw-semibold mb-2">{preview.subject}</div>
            <iframe
              sandbox=""
              srcdoc={preview.html}
              class="adm-email-preview-frame"
              title={`${label} invitation preview`}
            />
            <div class="form-check mt-2">
              <input
                id={`invite-confirm-${type}`}
                class="form-check-input"
                type="checkbox"
                checked={confirmed}
                onChange={(input) => setConfirmed(input.currentTarget.checked)}
              />
              <label class="form-check-label small" for={`invite-confirm-${type}`}>
                I reviewed this preview and confirm sending this email.
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
