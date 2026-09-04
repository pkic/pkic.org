import { useState } from "preact/hooks";
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
import { Textarea, TextInput } from "../../../../ui/TextControl";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../../ui/Content.css";

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
 * There is no template to choose here, and under
 * applicationCommunicationCreateSchema that is what makes the message the
 * message: the subject and body typed into this form are the subject and body
 * the applicant receives. So the form sends no `templateKey`, and the help
 * text under the message promises exactly the delivery the contract gives.
 */
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
  const [commSubject, setCommSubject] = useState("");
  const [commBody, setCommBody] = useState("");
  const [commSending, setCommSending] = useState(false);
  const [commError, setCommError] = useState("");
  const communication = useContractForm(applicationCommunicationCreateSchema, {
    subject: commSubject,
    body: commBody,
  });

  const [noteBody, setNoteBody] = useState("");
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
      setCommError(checked.message);
      return;
    }
    setCommSending(true);
    try {
      await onSendCommunication(checked.data);
      setCommSubject("");
      setCommBody("");
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
      setNoteError(checked.message);
      return;
    }
    setNoteSaving(true);
    try {
      await onAddNote(checked.data.body);
      setNoteBody("");
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
        <PanelBody class="pk-stack">
          <DataTable
            caption="Communication and note history"
            rows={detail.communications}
            rowKey={(record) => record.id}
            empty="Nothing has been emailed or noted on this application yet."
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
                // The first labelled column is fit-width here, so the prose
                // column claims the slack explicitly.
                width: "primary",
                cell: (record) => (
                  <div class="pk-stack pk-stack--tight">
                    {record.subject && <strong>{record.subject}</strong>}
                    <span class="pk-break">{record.body}</span>
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

          {canWrite && (
            <>
              <form
                noValidate
                class="pk-stack pk-stack--snug"
                {...communication.handlers}
                onSubmit={(event) => void submitCommunication(event)}
              >
                <h4>Send communication</h4>
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
                    help="Emailed to the applicant exactly as written, and recorded on this timeline."
                    {...communication.of("body")}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        name="body"
                        rows={2}
                        value={commBody}
                        onInput={(event) => setCommBody((event.target as HTMLTextAreaElement).value)}
                      />
                    )}
                  </Field>
                </fieldset>
                {commError && <Alert tone="danger">{commError}</Alert>}
                <div class="pk-cluster">
                  <Button type="submit" variant="primary" size="sm" loading={commSending}>
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
                <h4>Add internal note</h4>
                <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={noteSaving}>
                  <Field
                    label="Internal note"
                    required
                    help="Never emailed. Visible to staff only."
                    {...note.of("body")}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        name="body"
                        rows={2}
                        value={noteBody}
                        onInput={(event) => setNoteBody((event.target as HTMLTextAreaElement).value)}
                      />
                    )}
                  </Field>
                </fieldset>
                {noteError && <Alert tone="danger">{noteError}</Alert>}
                <div class="pk-cluster">
                  <Button type="submit" size="sm" loading={noteSaving}>
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
