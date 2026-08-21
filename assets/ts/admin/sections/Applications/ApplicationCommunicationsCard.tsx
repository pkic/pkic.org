import { useState } from "preact/hooks";
import { fmt } from "../../ui";
import type { AdminApplicationDetail } from "../../types";

export function ApplicationCommunicationsCard({
  detail,
  onSendCommunication,
  onAddNote,
}: {
  detail: AdminApplicationDetail;
  onSendCommunication: (params: { subject: string; body: string }) => Promise<void>;
  onAddNote: (body: string) => Promise<void>;
}) {
  const [commSubject, setCommSubject] = useState("");
  const [commBody, setCommBody] = useState("");
  const [noteBody, setNoteBody] = useState("");

  async function submitCommunication(e: Event) {
    e.preventDefault();
    if (!commSubject.trim() || !commBody.trim()) return;
    await onSendCommunication({ subject: commSubject, body: commBody });
    setCommSubject("");
    setCommBody("");
  }

  async function submitNote(e: Event) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    await onAddNote(noteBody);
    setNoteBody("");
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Communications &amp; notes</div>
      <div class="card-body">
        <ul class="list-unstyled small mb-3">
          {[...detail.communications].map((c) => (
            <li key={c.id} class="mb-2 pb-2 border-bottom">
              <span class="badge text-bg-secondary me-1">{c.kind}</span>
              {c.subject && <strong>{c.subject}</strong>}
              <div class="text-muted">{c.body}</div>
              <div class="mono text-muted small">{fmt(c.createdAt)}</div>
            </li>
          ))}
          {detail.communications.length === 0 && <li class="text-muted">None yet.</li>}
        </ul>
        <form onSubmit={(e) => void submitCommunication(e)} class="mb-2">
          <div class="mb-1 fw-semibold small">Send communication</div>
          <input
            class="form-control form-control-sm mb-1"
            placeholder="Subject"
            value={commSubject}
            onInput={(e) => setCommSubject((e.target as HTMLInputElement).value)}
          />
          <textarea
            class="form-control form-control-sm mb-1"
            rows={2}
            placeholder="Message"
            value={commBody}
            onInput={(e) => setCommBody((e.target as HTMLTextAreaElement).value)}
          />
          <button type="submit" class="btn btn-sm btn-outline-primary">
            Send
          </button>
        </form>
        <form onSubmit={(e) => void submitNote(e)}>
          <div class="mb-1 fw-semibold small">Add internal note</div>
          <textarea
            class="form-control form-control-sm mb-1"
            rows={2}
            placeholder="Note (never emailed)"
            value={noteBody}
            onInput={(e) => setNoteBody((e.target as HTMLTextAreaElement).value)}
          />
          <button type="submit" class="btn btn-sm btn-outline-secondary">
            Add note
          </button>
        </form>
      </div>
    </div>
  );
}
