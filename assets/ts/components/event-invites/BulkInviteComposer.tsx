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
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Textarea, TextInput } from "../../ui/TextControl";

// `pk-framed` on the preview iframe comes from the content stylesheet, which
// is not in the entry chunk: a class written here is only styled if this
// module pulls its sheet in.
import "../../ui/Content.css";

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
  const confirmId = `invite-confirm-${type}`;

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
    <section aria-label={`Send ${label} invitations`} class="pk pk-stack">
      <div class="pk-stack pk-stack--snug">
        <Field label="Paste emails and names" help="One address per line. Bob Smith <bob@example.com> also works.">
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              value={pasteText}
              onInput={(input) => setPasteText(input.currentTarget.value)}
              placeholder={"alice@example.com\nBob Smith <bob@example.com>"}
            />
          )}
        </Field>
        <div class="pk-cluster">
          <Button size="sm" onClick={parsePastedRows}>
            Parse
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Upload CSV
          </Button>
          {/* The button above is the control a reader reaches; the input
              itself is taken out of the page rather than merely made
              invisible, so nothing tabs into an unlabeled file picker. */}
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={loadFile} />
        </div>
      </div>

      {/* A grid rather than a cluster: a control is full-width by design, so
          three of them in a wrapping flex row would each take a line of their
          own. The grid gives them a column each and folds to one column on a
          narrow viewport without a breakpoint class. */}
      <div class="pk-stack pk-stack--snug">
        {rows.map((row, index) => (
          <div key={row.key} class="pk-grid pk-grid--tight">
            <TextInput
              aria-label={`${label} ${index + 1} first name`}
              placeholder="First"
              value={row.firstName ?? ""}
              onInput={(input) => updateRow(row.key, { firstName: input.currentTarget.value })}
            />
            <TextInput
              aria-label={`${label} ${index + 1} last name`}
              placeholder="Last"
              value={row.lastName ?? ""}
              onInput={(input) => updateRow(row.key, { lastName: input.currentTarget.value })}
            />
            <TextInput
              aria-label={`${label} ${index + 1} email address`}
              placeholder="email@example.com"
              type="email"
              value={row.email}
              onInput={(input) => updateRow(row.key, { email: input.currentTarget.value })}
            />
            {/* The cluster keeps the button at its own width inside its grid
                cell. Named per row: "Remove attendee row" repeated six times
                gives a reader no way to tell which one they are on. */}
            <div class="pk-cluster pk-cluster--end">
              <Button
                size="sm"
                variant="danger-quiet"
                icon
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
          </div>
        ))}
        <div class="pk-cluster">
          <Button
            size="sm"
            onClick={() => {
              setRows((current) => [...current, { key: nextKey, email: "" }]);
              setNextKey((key) => key + 1);
            }}
          >
            Add row
          </Button>
        </div>
      </div>

      <Field
        label="Invitation deadline"
        help="Leave blank to use the event start. A custom deadline cannot be later than the event end."
      >
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={expiresAt}
            max={latestExpiry}
            onInput={(input) => {
              setExpiresAt(input.currentTarget.value);
              resetPreview();
            }}
          />
        )}
      </Field>

      <div class="pk-cluster">
        <Button size="sm" onClick={() => void renderPreview()}>
          Preview email
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!preview || !confirmed}
          loading={sending}
          onClick={() => void send()}
        >
          Send {label} invites
        </Button>
        <span class="pk-small">{validRows.length} valid</span>
      </div>

      {/*
       * These two lines are the only account of what preview and send did, so
       * they are live regions: a reader who has tabbed past the buttons is
       * told the result instead of having to go looking for it. Each says what
       * happened in words, so nothing here is carried by colour alone.
       */}
      {previewStatus && (
        <p class="pk-small" role="status">
          {previewStatus}
        </p>
      )}
      {sendStatus && (
        <p class="pk-small" role="status">
          {sendStatus}
        </p>
      )}

      {preview && (
        <Panel>
          <PanelHeader title="Email preview" />
          <PanelBody class="pk-stack pk-stack--snug">
            <div class="pk-stack pk-stack--tight">
              <span class="pk-small">Subject</span>
              <span class="pk-strong">{preview.subject}</span>
            </div>
            {/*
             * The rendered invitation is author-supplied HTML, so it stays in
             * an iframe with an empty `sandbox`: no scripts, no forms, no
             * same-origin access, no navigation. Neither may be relaxed.
             */}
            <iframe
              sandbox=""
              srcdoc={preview.html}
              class="pk-framed"
              height={600}
              title={`${label} invitation preview`}
            />
            <div class="pk-check">
              <input
                id={confirmId}
                class="pk-check__input"
                type="checkbox"
                checked={confirmed}
                onChange={(input) => setConfirmed(input.currentTarget.checked)}
              />
              <label class="pk-check__label pk-small" for={confirmId}>
                I reviewed this preview and confirm sending this email.
              </label>
            </div>
          </PanelBody>
        </Panel>
      )}
    </section>
  );
}
