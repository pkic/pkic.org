/** The existing registration-confirmation invitation form, also used by the attendee modal. */
import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useState, useCallback, useId, useRef, useEffect } from "preact/hooks";
import { parseContactText, type ParsedContact } from "../../shared/invite-parser";
import {
  registrationInviteCreateSchema,
  peerInviteResultSchema,
  REGISTRATION_PEER_INVITE_BATCH_LIMIT,
} from "../../../shared/schemas/registration";
import { postJson } from "../../shared/api-client";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Dialog } from "../../ui/Dialog";
import { TextInput, Textarea } from "../../ui/TextControl";

const MAX_INVITES = REGISTRATION_PEER_INVITE_BATCH_LIMIT;

interface InviteRowData {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}

function InviteRow({
  row,
  position,
  showRemove,
  onChange,
  onRemove,
  onPasteEmail,
  contract,
}: {
  row: InviteRowData;
  position: number;
  showRemove: boolean;
  onChange: (id: number, field: keyof Omit<InviteRowData, "id">, value: string) => void;
  onRemove: (id: number) => void;
  onPasteEmail: (id: number, text: string) => void;
  contract: ReturnType<typeof useContractForm<typeof registrationInviteCreateSchema>>;
}) {
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
      e.preventDefault();
      onPasteEmail(row.id, pasted);
    },
    [row.id, onPasteEmail],
  );

  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-grid pk-grid--tight">
        <Field label={`Invite ${position} first name (optional)`} {...contract.of(`invites.${position - 1}.firstName`)}>
          {(control) => (
            <TextInput
              {...control}
              name={`invites.${position - 1}.firstName`}
              value={row.firstName}
              onInput={(event) => onChange(row.id, "firstName", event.currentTarget.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={`Invite ${position} last name (optional)`} {...contract.of(`invites.${position - 1}.lastName`)}>
          {(control) => (
            <TextInput
              {...control}
              name={`invites.${position - 1}.lastName`}
              value={row.lastName}
              onInput={(event) => onChange(row.id, "lastName", event.currentTarget.value)}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <Field label={`Invite ${position} email address`} required {...contract.of(`invites.${position - 1}.email`)}>
        {(control) => (
          <TextInput
            {...control}
            name={`invites.${position - 1}.email`}
            type="email"
            value={row.email}
            onInput={(event) => onChange(row.id, "email", event.currentTarget.value)}
            onPaste={handlePaste}
            autoComplete="off"
          />
        )}
      </Field>
      {/* Named per row: "Remove row" repeated ten times gives a reader no way
          to tell which one they are about to delete. */}
      <div class="pk-cluster pk-cluster--end">
        {showRemove && (
          <Button variant="danger-quiet" icon aria-label={`Remove invite ${position}`} onClick={() => onRemove(row.id)}>
            <span aria-hidden="true">×</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Invite panel ────────────────────────────────────────────────────────────

let nextRowId = 1;
function makeRow(entry?: ParsedContact): InviteRowData {
  return {
    id: nextRowId++,
    email: entry?.email ?? "",
    firstName: entry?.firstName ?? "",
    lastName: entry?.lastName ?? "",
  };
}

export function RegistrationInviteForm({
  manageToken,
  eventSlug,
  presentation = "disclosure",
  formRef,
  onSendingChange,
  onSent,
}: {
  manageToken?: string;
  eventSlug: string;
  presentation?: "disclosure" | "dialog";
  formRef?: RefObject<HTMLFormElement>;
  onSendingChange?: (sending: boolean) => void;
  onSent?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<InviteRowData[]>(() => [makeRow()]);
  const [status, setStatus] = useState<{ message: string; tone: "ok" | "danger" } | null>(null);
  const [sending, setSending] = useState(false);
  const requestPending = useRef(false);
  const contract = useContractForm(registrationInviteCreateSchema, {
    invites: rows.map((row) => ({
      email: row.email.trim(),
      firstName: row.firstName.trim() || undefined,
      lastName: row.lastName.trim() || undefined,
    })),
  });
  useEffect(() => {
    onSendingChange?.(sending);
  }, [sending, onSendingChange]);
  const fieldsRef = useRef<HTMLDivElement>(null);
  // Generated rather than fixed: two share panels can share a page, and a
  // duplicated id would point both toggles at the same set of fields.
  const fieldsId = useId();

  const showRemove = rows.length > 1;

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      if (!prev) {
        setTimeout(() => fieldsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      }
      return !prev;
    });
  }, []);

  const updateRow = useCallback((id: number, field: keyof Omit<InviteRowData, "id">, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setStatus(null);
  }, []);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addRow = useCallback((entry?: ParsedContact) => {
    setRows((prev) => {
      if (prev.length >= MAX_INVITES) return prev;
      return [...prev, makeRow(entry)];
    });
  }, []);

  const handlePasteEmail = useCallback((rowId: number, text: string) => {
    const entries = parseContactText(text);
    if (!entries.length) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        email: entries[0].email,
        firstName: entries[0].firstName ?? "",
        lastName: entries[0].lastName ?? "",
      };
      for (const entry of entries.slice(1)) {
        if (updated.length >= MAX_INVITES) break;
        updated.push(makeRow(entry));
      }
      return updated;
    });
  }, []);

  const handlePasteArea = useCallback((e: ClipboardEvent) => {
    setTimeout(() => {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;
      if (!text.trim()) return;
      const entries = parseContactText(text);
      if (!entries.length) return;

      setRows((prev) => {
        const updated = [...prev];
        let entryIdx = 0;
        // Fill existing empty rows first
        for (let i = 0; i < updated.length && entryIdx < entries.length; i++) {
          if (!updated[i].email.trim()) {
            updated[i] = {
              ...updated[i],
              email: entries[entryIdx].email,
              firstName: entries[entryIdx].firstName ?? "",
              lastName: entries[entryIdx].lastName ?? "",
            };
            entryIdx++;
          }
        }
        // Add remaining as new rows
        for (; entryIdx < entries.length && updated.length < MAX_INVITES; entryIdx++) {
          updated.push(makeRow(entries[entryIdx]));
        }
        return updated;
      });
      textarea.value = "";
    }, 0);
  }, []);

  const handleSend = async () => {
    if (requestPending.current) return;
    const checked = contract.submit();
    if (!checked.data) {
      setStatus(checked.formMessage ? { message: checked.formMessage, tone: "danger" } : null);
      return;
    }
    requestPending.current = true;
    setSending(true);
    setStatus(null);

    try {
      const data = await postJson(
        `/api/v1/events/${encodeURIComponent(eventSlug)}/invites`,
        checked.data,
        peerInviteResultSchema,
        manageToken ? { authorization: `Bearer ${manageToken}` } : undefined,
      );
      const count = data.created.length;
      setStatus({
        message: `Queued ${count} invitation${count !== 1 ? "s" : ""}.${data.endorsed.length ? ` Linked ${data.endorsed.length} existing invitation${data.endorsed.length === 1 ? "" : "s"} to you.` : ""}${data.skipped.length ? ` Skipped ${data.skipped.length} recipient${data.skipped.length === 1 ? "" : "s"}.` : ""}`,

        tone: "ok",
      });
      setRows([makeRow()]);
      contract.reset();
      onSent?.();
    } catch (error) {
      setStatus({
        message: contract.refuse(error),
        tone: "danger",
      });
    } finally {
      requestPending.current = false;
      setSending(false);
    }
  };

  return (
    <div class="pk-stack pk-stack--snug">
      {presentation === "disclosure" && (
        <div class="pk-cluster">
          <Button onClick={toggleExpanded} aria-expanded={expanded} aria-controls={fieldsId}>
            Invite by email
          </Button>
        </div>
      )}

      <div
        id={fieldsId}
        class="pk-stack pk-stack--snug"
        hidden={presentation === "disclosure" && !expanded}
        ref={fieldsRef}
      >
        <form
          ref={formRef}
          noValidate
          {...contract.handlers}
          class="pk-stack pk-stack--snug"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <div
            inert={sending}
            hidden={presentation === "dialog" && status?.tone === "ok"}
            class="pk-stack pk-stack--snug"
          >
            <p class="pk-small">
              We'll send a personal invitation on your behalf — they'll receive a direct registration link. Paste a list
              below or fill in rows one by one.
            </p>

            <div class="pk-stack pk-stack--snug">
              {rows.map((row, index) => (
                <InviteRow
                  key={row.id}
                  row={row}
                  position={index + 1}
                  showRemove={showRemove}
                  onChange={updateRow}
                  onRemove={removeRow}
                  onPasteEmail={handlePasteEmail}
                  contract={contract}
                />
              ))}
            </div>
            <Field
              label="Paste email addresses to add"
              help={'Names are inferred from dotted addresses or the "Name <email>" format.'}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  placeholder={"alice@example.net\nBob Smith <bob@example.com>\ncarol.jones@co.example…"}
                  onPaste={handlePasteArea}
                />
              )}
            </Field>
            <div class="pk-cluster">
              {rows.length < MAX_INVITES && <Button onClick={() => addRow()}>Add row</Button>}
              {presentation === "disclosure" && (
                <Button type="submit" variant="primary" loading={sending}>
                  Send invites
                </Button>
              )}
            </div>
          </div>
          {status && <Alert tone={status.tone}>{status.message}</Alert>}
        </form>
      </div>
    </div>
  );
}

/** The confirmation page's invitation form, hosted in the existing dialog. */
export function InviteColleagueDialog({ eventSlug, onClose }: { eventSlug: string; onClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  return createPortal(
    <Dialog
      open
      title="Invite a colleague"
      closeLabel="Close invite a colleague"
      confirmLabel={sent ? "Done" : sending ? "Sending…" : "Send invites"}
      cancelLabel={sent ? null : "Cancel"}
      confirmDisabled={sending}
      onConfirm={() => {
        if (sent) onClose();
        else formRef.current?.requestSubmit();
      }}
      onCancel={() => {
        if (!sending) onClose();
      }}
    >
      <RegistrationInviteForm
        eventSlug={eventSlug}
        presentation="dialog"
        formRef={formRef}
        onSendingChange={setSending}
        onSent={() => setSent(true)}
      />
    </Dialog>,
    document.body,
  );
}
