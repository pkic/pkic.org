import { useState } from "preact/hooks";
import {
  groupVoteProposalCreateResponseSchema,
  groupVoteProposalCreateSchema,
} from "../../../../../shared/schemas/group-vote-proposals";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";

export function GroupVoteProposalForm({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<"motion" | "consultation">("motion");
  const [proposedOpensAt, setProposedOpensAt] = useState("");
  const [proposedClosesAt, setProposedClosesAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = groupVoteProposalCreateSchema.parse({
        title,
        description,
        voteType,
        proposedOpensAt: proposedOpensAt ? new Date(proposedOpensAt).toISOString() : null,
        proposedClosesAt: proposedClosesAt ? new Date(proposedClosesAt).toISOString() : null,
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals`,
        input,
        groupVoteProposalCreateResponseSchema,
      );
      setTitle("");
      setDescription("");
      setProposedOpensAt("");
      setProposedClosesAt("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not submit the proposal."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk" aria-label="Propose a vote" onSubmit={(event) => void submit(event)}>
      <Panel>
        <PanelHeader title="Propose a vote" />
        <PanelBody class="pk-stack">
          <p class="pk-small">Proposals are opened for endorsement under this group&rsquo;s voting policy.</p>
          <ErrorAlert error={error} />
          {/* One disabled fieldset takes every field out of play while the
              submit is in flight. The button stays outside it so the control
              the reader just pressed is not disabled from under them. */}
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            <div class="pk-grid pk-grid--roomy">
              <Field label="Title" required>
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={300}
                    value={title}
                    onInput={(event) => setTitle(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Type">
                {(control) => (
                  <Select
                    {...control}
                    value={voteType}
                    onChange={(event) => setVoteType(event.currentTarget.value as typeof voteType)}
                  >
                    <option value="motion">Motion</option>
                    <option value="consultation">Consultation</option>
                  </Select>
                )}
              </Field>
            </div>
            {/* The description runs the full width rather than sharing a grid
                row: a four-row textarea in a half column is unusable. */}
            <Field label="Description" required>
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  maxLength={10000}
                  value={description}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                />
              )}
            </Field>
            <div class="pk-grid pk-grid--roomy">
              {/* "(optional)" moves out of the label and into the help text:
                  the label names the control, the help says what is expected
                  of it, and only the required fields carry a marker. */}
              <Field label="Proposed opening time" help="Leave empty to let the group decide when to open.">
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={proposedOpensAt}
                    onInput={(event) => setProposedOpensAt(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Proposed closing time" help="Leave empty to let the group decide when to close.">
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={proposedClosesAt}
                    onInput={(event) => setProposedClosesAt(event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              {saving ? "Submitting…" : "Submit proposal"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}
