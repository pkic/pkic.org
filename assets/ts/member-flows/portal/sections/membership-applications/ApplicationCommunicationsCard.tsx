import { useId, useState } from "preact/hooks";
import { fmt } from "../../ui";
import {
  applicationCommunicationCreateSchema,
  applicationNoteCreateSchema,
  type ApplicationCommunicationCreate,
  type MembershipApplicationCommunication,
  type MembershipApplicationDetail,
} from "../../../../../shared/schemas/membership-application-management";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { DataTable } from "../../../../ui/DataTable";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Markdown } from "../../../../ui/Markdown";
import { TextInput } from "../../../../ui/TextControl";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";
import { SectionHeading } from "../../../../ui/SectionHeading";

/** What a record on this timeline is. The word carries it; the tone repeats it. */
const KIND_LABEL: Record<MembershipApplicationCommunication["kind"], string> = {
  communication: "Emailed",
  note: "Internal note",
};

/**
 * The staff-only timeline for one application, and the two forms that add to
 * it.
 *
 * The record list is a captioned table rather than the unnamed bulleted list
 * it used to be: these are three fields repeated per row, and the caption is
 * what tells a reader which of the page's several tables they have landed in.
 *
 * Both forms used to fail silently — a blank subject returned from the submit
 * handler with nothing said, and a rejected send left the fields full with no
 * explanation. Each control now names itself through a Field, each form is
 * checked by the request contract its route parses, an empty required value
 * is reported on the control it belongs to, and a failed request is announced
 * instead of discarded.
 *
 * Messages and notes are both written in the shared Markdown editor and read
 * back through the shared renderer, so a fenced block (such as the source
 * metadata on an imported application) shows as code rather than one run of
 * text.
 *
 * The message goes out through the `application_request_information`
 * template (#108): the subject typed here is the subject the applicant
 * receives — the template carries none of its own — and the body is set into
 * the template's greeting and sign-off, so the shell and wording around it
 * are managed with the other application emails.
 */
export const APPLICATION_REQUEST_INFORMATION_TEMPLATE_KEY = "application_request_information";
export function ApplicationCommunicationsCard({
  detail,
  canWrite,
  onSendCommunication,
  onAddNote,
}: {
  detail: MembershipApplicationDetail;
  canWrite: boolean;
  onSendCommunication: (params: ApplicationCommunicationCreate) => Promise<void>;
  onAddNote: (body: string) => Promise<void>;
}) {
  const messageId = useId();
  const [expandedMessages, setExpandedMessages] = useState<ReadonlySet<string>>(new Set());

  function toggleMessage(id: string) {
    setExpandedMessages((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [commSubject, setCommSubject] = useState("");
  const [commBody, setCommBody] = useState("");
  // The editor is uncontrolled; a sent message clears it by remounting it.
  const [bodyGeneration, setBodyGeneration] = useState(0);
  const [commSending, setCommSending] = useState(false);
  const [commError, setCommError] = useState("");
  const communication = useContractForm(applicationCommunicationCreateSchema, {
    subject: commSubject,
    body: commBody,
    templateKey: APPLICATION_REQUEST_INFORMATION_TEMPLATE_KEY,
  });

  const [noteBody, setNoteBody] = useState("");
  const [noteGeneration, setNoteGeneration] = useState(0);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const note = useContractForm(applicationNoteCreateSchema, { body: noteBody });

  async function submitCommunication(event: Event) {
    event.preventDefault();
    // A loading Button stays focusable and therefore clickable, so the guard
    // against sending the same message twice belongs here rather than on it.
    if (commSending) return;
    setCommError("");
    const checked = communication.submit();
    if (!checked.data) {
      setCommError(checked.formMessage ?? "");
      return;
    }
    setCommSending(true);
    try {
      await onSendCommunication(checked.data);
      setCommSubject("");
      setCommBody("");
      setBodyGeneration((generation) => generation + 1);
      communication.reset();
    } catch (error) {
      setCommError(communication.refuse(error));
    } finally {
      setCommSending(false);
    }
  }

  async function submitNote(event: Event) {
    event.preventDefault();
    if (noteSaving) return;
    setNoteError("");
    const checked = note.submit();
    if (!checked.data) {
      setNoteError(checked.formMessage ?? "");
      return;
    }
    setNoteSaving(true);
    try {
      await onAddNote(checked.data.body);
      setNoteBody("");
      setNoteGeneration((generation) => generation + 1);
      note.reset();
    } catch (error) {
      setNoteError(note.refuse(error));
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <div class="pk">
      <Panel aria-label="Communications and notes">
        <PanelHeader title="Communications and notes" />
        <DataTable
          caption="Communication and note history"
          rows={detail.communications}
          rowKey={(record) => record.id}
          empty="Nothing has been emailed or noted on this application yet."
          detailRow={(record) =>
            expandedMessages.has(record.id) ? (
              <PanelBody id={`${messageId}-${record.id}`}>
                <Markdown markdown={record.body} />
              </PanelBody>
            ) : null
          }
          columns={[
            {
              id: "kind",
              header: "Kind",
              cell: (record) => (
                <Badge tone={record.kind === "communication" ? "info" : "neutral"}>{KIND_LABEL[record.kind]}</Badge>
              ),
              width: "fit",
            },
            {
              id: "message",
              header: "Message",
              // The first labeled column is fit-width here, so the prose
              // column claims the slack explicitly.
              width: "primary",
              cell: (record) => (
                <div class="pk-stack pk-stack--tight">
                  {record.subject && <strong>{record.subject}</strong>}
                  <div>
                    <Button
                      variant="ghost"
                      aria-expanded={expandedMessages.has(record.id)}
                      aria-controls={expandedMessages.has(record.id) ? `${messageId}-${record.id}` : undefined}
                      onClick={() => toggleMessage(record.id)}
                    >
                      {expandedMessages.has(record.id) ? "Hide message" : "Read message"}
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              // A timestamp has a bounded length; the column hugs it and
              // keeps the table's own ink and size.
              id: "recorded",
              header: "Recorded",
              cell: (record) => fmt(record.createdAt),
              width: "fit",
            },
          ]}
        />
        <PanelBody class="pk-stack">
          {canWrite && (
            <>
              <form
                noValidate
                class="pk-stack pk-stack--snug"
                {...communication.handlers}
                onSubmit={(event) => void submitCommunication(event)}
              >
                <SectionHeading level={4}>Send communication</SectionHeading>
                <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={commSending}>
                  <Field label="Subject" required {...communication.of("subject")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name="subject"
                        value={commSubject}
                        onInput={(event) => setCommSubject((event.target as HTMLInputElement).value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="Message"
                    required
                    help="Emailed to the applicant inside the application_request_information template, and recorded on this timeline."
                    {...communication.of("body")}
                  >
                    {(control) => (
                      <MarkdownEditor
                        key={bodyGeneration}
                        {...control}
                        variant="compact"
                        name="body"
                        label="Message"
                        initialValue={commBody}
                        onChange={setCommBody}
                      />
                    )}
                  </Field>
                </fieldset>
                {commError && <Alert tone="danger">{commError}</Alert>}
                <div class="pk-cluster">
                  <Button type="submit" variant="primary" loading={commSending}>
                    {commSending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </form>

              <form
                noValidate
                class="pk-stack pk-stack--snug"
                {...note.handlers}
                onSubmit={(event) => void submitNote(event)}
              >
                <SectionHeading level={4}>Add internal note</SectionHeading>
                <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={noteSaving}>
                  <Field
                    label="Internal note"
                    required
                    help="Never emailed. Visible to staff only."
                    {...note.of("body")}
                  >
                    {(control) => (
                      <MarkdownEditor
                        key={noteGeneration}
                        {...control}
                        variant="compact"
                        name="body"
                        label="Internal note"
                        initialValue={noteBody}
                        onChange={setNoteBody}
                      />
                    )}
                  </Field>
                </fieldset>
                {noteError && <Alert tone="danger">{noteError}</Alert>}
                <div class="pk-cluster">
                  <Button type="submit" loading={noteSaving}>
                    {noteSaving ? "Adding…" : "Add note"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
