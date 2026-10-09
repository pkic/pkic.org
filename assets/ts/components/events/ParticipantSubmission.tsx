import { useState } from "preact/hooks";
import {
  proposalAccessPatchSchema,
  proposalAccessPatchResponseSchema,
  type ProposalAccessResponse,
} from "../../../shared/schemas/proposal-management";
import {
  isProposalSelfServiceEditableStatus,
  isProposalSpeakerRosterEditableStatus,
} from "../../../shared/schemas/proposal-status";
import type { EventInviteWindow } from "../../../shared/schemas/event-invite-validity";
import type { EventFormsResponse } from "../../shared/types";
import { proposalAccessPath } from "../../../shared/proposal-access-paths";
import { useContractForm } from "../../hooks/useContractForm";
import { patchJson } from "../../shared/api-client";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { SpeakerList } from "../proposals/ProposerSpeakerList";
import { ProposalCoSpeakerInviteForm } from "../proposals/ProposalCoSpeakerInviteForm";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { DescriptionList } from "../../ui/DescriptionList";
import { Markdown } from "../../ui/Markdown";
import { Menu } from "../../ui/Menu";
import { FormAnswerTable } from "../forms/FormResponseViews";

export function ParticipantSubmission({
  data,
  forms,
  event,
  facet,
  reload,
}: {
  data: ProposalAccessResponse;
  forms: EventFormsResponse;
  event: EventInviteWindow;
  facet: string;
  reload: () => Promise<void>;
}) {
  const proposal = data.proposal;
  const access = { resourceId: proposal.id };
  const endpoint = proposalAccessPath("/api/v1", access);
  const [title, setTitle] = useState(proposal.title);
  const [abstract, setAbstract] = useState(proposal.abstract);
  const [proposalType, setType] = useState(proposal.proposal_type);
  const [details, setDetails] = useState(proposal.details ?? {});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const form = useContractForm(proposalAccessPatchSchema, {
    title,
    abstract,
    proposalType,
    details: forms.form ? details : undefined,
  });
  async function save(body: unknown, done: string) {
    setBusy(true);
    setError("");
    try {
      await patchJson(endpoint, proposalAccessPatchSchema.parse(body), proposalAccessPatchResponseSchema);
      setMessage(done);
      setEditing(false);
      await reload();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  if (facet === "speakers")
    return (
      <div class="pk-stack">
        {message && <Alert tone="ok">{message}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {isProposalSpeakerRosterEditableStatus(proposal.status) ? (
          <>
            <SpeakerList
              speakers={data.speakers}
              token={access}
              apiBase="/api/v1"
              proposerUserId={proposal.proposer_user_id}
              onReload={reload}
              onStatus={(text, failed) => (failed ? setError(text) : setMessage(text))}
            />
            <ProposalCoSpeakerInviteForm
              endpoint={proposalAccessPath("/api/v1", access, "speakers")}
              event={event}
              allowUserSearch={false}
              onInvited={reload}
              notify={(text, kind) => (kind === "error" ? setError(text) : setMessage(text))}
            />
          </>
        ) : (
          <Panel>
            <PanelHeader title="Speakers" />
            <PanelBody>
              <p>This proposal is closed. The speaker lineup cannot be changed.</p>
              {data.speakers.map((speaker) => (
                <p key={speaker.userId}>
                  {[speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email} · {speaker.status}
                </p>
              ))}
            </PanelBody>
          </Panel>
        )}
      </div>
    );
  const editable = isProposalSelfServiceEditableStatus(proposal.status);
  function stopEditing() {
    setTitle(proposal.title);
    setAbstract(proposal.abstract);
    setType(proposal.proposal_type);
    setDetails(proposal.details ?? {});
    form.reset();
    setEditing(false);
  }
  async function withdraw() {
    const confirmed = await confirmAction({
      title: `Withdraw ${proposal.title}?`,
      consequences: [
        "The proposal is withdrawn from review",
        "You can no longer change the submission or its speakers",
      ],
      confirmLabel: "Withdraw proposal",
      cancelLabel: "Keep proposal",
      tone: "danger",
    });
    if (confirmed) await save({ status: "withdrawn" }, "Proposal withdrawn.");
  }
  return (
    <Panel aria-label="Submission">
      <PanelHeader title="Submission">
        {editable && !editing && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setError("");
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Menu
              label="Submission actions"
              align="end"
              items={[
                {
                  id: "withdraw",
                  label: "Withdraw proposal…",
                  danger: true,
                  disabled: busy,
                  onSelect: () => void withdraw(),
                },
              ]}
            />
          </>
        )}
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <div class="pk-cluster">
            <Badge status={proposal.status} />
          </div>
          {!editable && (
            <Alert>
              This proposal is {proposal.status.replaceAll("_", " ")}. Submission changes and withdrawal are no longer
              available.
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {message && <Alert tone="ok">{message}</Alert>}
          {editable && editing ? (
            <form
              noValidate
              {...form.handlers}
              onSubmit={(event) => {
                event.preventDefault();
                const checked = form.submit();
                if (!checked.data) {
                  setError(checked.message);
                  return;
                }
                void save(checked.data, "Proposal updated.");
              }}
            >
              <fieldset class="pk-fieldset pk-stack" disabled={busy}>
                <Field label="Title" {...form.of("title")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="title"
                      value={title}
                      onInput={(event) => setTitle(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Session type" {...form.of("proposalType")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="proposalType"
                      value={proposalType}
                      onChange={(event) => setType(event.currentTarget.value)}
                    >
                      {forms.allowedSessionTypes.map((type) => (
                        <option value={type} key={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Abstract" {...form.of("abstract")}>
                  {(control) => (
                    <MarkdownEditor
                      disabled={busy}
                      variant="compact"
                      {...control}
                      name="abstract"
                      label="Abstract"
                      initialValue={abstract}
                      onChange={setAbstract}
                    />
                  )}
                </Field>
                {forms.form && (
                  <div
                    class="pk-stack"
                    onInput={(event) => {
                      const parent = (event.target as HTMLElement).closest("form");
                      if (parent) setDetails(readCustomFieldValues(parent));
                    }}
                    onChange={(event) => {
                      const parent = (event.target as HTMLElement).closest("form");
                      if (parent) setDetails(readCustomFieldValues(parent));
                    }}
                  >
                    <CustomFieldList
                      fields={forms.form.fields}
                      initialValues={proposal.details ?? {}}
                      context={{ dayAttendance: [] }}
                    />
                  </div>
                )}
                <div class="pk-cluster">
                  <Button type="submit" variant="primary" loading={busy}>
                    Save proposal
                  </Button>
                  <Button type="button" onClick={stopEditing}>
                    Discard changes
                  </Button>
                </div>
              </fieldset>
            </form>
          ) : (
            <>
              <DescriptionList
                items={[
                  { term: "Title", value: proposal.title },
                  { term: "Session type", value: proposal.proposal_type },
                  {
                    term: "Abstract",
                    value: proposal.abstract ? <Markdown markdown={proposal.abstract} /> : undefined,
                  },
                ]}
              />
              {proposal.details && Object.keys(proposal.details).length > 0 && (
                <FormAnswerTable answers={proposal.details} fields={forms.form?.fields} />
              )}
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
