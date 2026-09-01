import { lazy, Suspense } from "preact/compat";
import { useId, useRef, useState } from "preact/hooks";
import {
  groupVoteBallotsAuditResponseSchema,
  groupVoteMutationResponseSchema,
  groupVoteUpdateInputSchema,
  groupVoteVisibilityUpdateInputSchema,
} from "../../../../../shared/schemas/group-vote-management";
import type { GroupVoteDetail } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { patchJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { fmt } from "../../ui";
import { GroupVoteLifecycleActions } from "./GroupVoteLifecycleActions";
// The ballot columns are written by class name (`pk-mono` for the opaque
// identifiers), and component CSS ships in a lazy chunk, so the stylesheet
// that defines them has to be imported by the module that names them.
import "../../../../ui/Content.css";

const GroupVoteStatistics = lazy(() =>
  import("./GroupVoteStatistics").then((module) => ({ default: module.GroupVoteStatistics })),
);

function localDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function GroupVoteManagementControls({
  groupId,
  vote,
  onChanged,
}: {
  groupId: string;
  vote: GroupVoteDetail;
  onChanged: () => Promise<void>;
}) {
  const headingId = useId();
  const ballotActions = useRef<ApiTableActions | null>(null);
  const [title, setTitle] = useState(vote.title);
  const [description, setDescription] = useState(vote.description ?? "");
  const [opensAt, setOpensAt] = useState(() => localDateTime(vote.opensAt));
  const [closesAt, setClosesAt] = useState(() => localDateTime(vote.closesAt));
  const [visibility, setVisibility] = useState(vote.visibility);
  const [publicDetailLevel, setPublicDetailLevel] = useState(vote.publicDetailLevel);
  const [showBallots, setShowBallots] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}`;

  async function saveSettings(event: Event): Promise<void> {
    event.preventDefault();
    // The submit control stays focusable while the save is in flight — a
    // disabled button drops the reader out of the form it is in — so the
    // handler, not the button, refuses a second submission.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = groupVoteUpdateInputSchema.parse({
        title,
        description: description || null,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
      });
      await patchJson(`${base}/settings`, input, groupVoteMutationResponseSchema);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update vote settings."));
    } finally {
      setBusy(false);
    }
  }

  async function saveVisibility(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = groupVoteVisibilityUpdateInputSchema.parse({ visibility, publicDetailLevel });
      await patchJson(`${base}/visibility`, input, groupVoteMutationResponseSchema);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update vote visibility."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel class="pk" aria-labelledby={headingId}>
      <PanelHeader id={headingId} title="Vote management" />
      <PanelBody class="pk-stack">
        <ErrorAlert error={error} />
        <GroupVoteLifecycleActions groupId={groupId} vote={vote} onChanged={onChanged} />

        <form class="pk-stack" aria-label="Vote settings" onSubmit={(event) => void saveSettings(event)}>
          {/* One disabled fieldset takes every control out of play while the
              save is in flight rather than each input deciding for itself.
              The submit button stays outside it so it keeps focus. */}
          <fieldset class="pk-fieldset pk-stack" disabled={busy}>
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
              <Field label="Description">
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={10000}
                    value={description}
                    onInput={(event) => setDescription(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Opens at" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={opensAt}
                    onInput={(event) => setOpensAt(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Closes at" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={closesAt}
                    onInput={(event) => setClosesAt(event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={busy}>
              Save settings
            </Button>
          </div>
        </form>

        <form class="pk-stack" aria-label="Vote visibility" onSubmit={(event) => void saveVisibility(event)}>
          <fieldset class="pk-fieldset pk-stack" disabled={busy}>
            <div class="pk-grid pk-grid--roomy">
              <Field label="Visibility">
                {(control) => (
                  <Select
                    {...control}
                    value={visibility}
                    onChange={(event) => setVisibility(event.currentTarget.value as typeof visibility)}
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </Select>
                )}
              </Field>
              <Field
                label="Public result detail"
                help="How much of the result a reader outside this group can see once the vote closes."
              >
                {(control) => (
                  <Select
                    {...control}
                    value={publicDetailLevel}
                    onChange={(event) => setPublicDetailLevel(event.currentTarget.value as typeof publicDetailLevel)}
                  >
                    <option value="outcome_only">Outcome only</option>
                    <option value="aggregate">Aggregate counts</option>
                    <option value="full_breakdown">Full breakdown</option>
                  </Select>
                )}
              </Field>
            </div>
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={busy}>
              Save visibility
            </Button>
          </div>
        </form>

        <div class="pk-stack pk-stack--snug">
          <div class="pk-cluster">
            <Button size="sm" aria-expanded={showBallots} onClick={() => setShowBallots((shown) => !shown)}>
              {showBallots ? "Hide identifiable ballots" : "Load identifiable ballots"}
            </Button>
          </div>
          {showBallots && (
            <ApiDataTable
              caption="Identifiable ballots"
              actionsRef={ballotActions}
              endpoint={`${base}/ballots`}
              responseSchema={groupVoteBallotsAuditResponseSchema}
              resolve={(response) => response.ballots}
              resolvePage={(response) => response.page}
              paginate
              searchPlaceholder="Search ballots…"
              initialSort="-submittedAt"
              columns={[
                {
                  header: "Voter",
                  className: "pk-mono",
                  cell: (ballot) => ballot.userId,
                  sort: { asc: "userId", desc: "-userId" },
                },
                {
                  header: "Member",
                  className: "pk-mono",
                  cell: (ballot) => ballot.memberId ?? "—",
                  sort: { asc: "memberId", desc: "-memberId" },
                },
                { header: "Choice", cell: (ballot) => ballot.choice, sort: { asc: "choice", desc: "-choice" } },
                {
                  header: "Round",
                  className: "pk-end",
                  width: "fit",
                  cell: (ballot) => ballot.round,
                  sort: { asc: "round", desc: "-round" },
                },
                {
                  // A date has a bounded length; the column says so instead
                  // of wearing `pk-nowrap` while still claiming slack.
                  header: "Submitted",
                  width: "fit",
                  cell: (ballot) => fmt(ballot.submittedAt),
                  sort: { asc: "submittedAt", desc: "-submittedAt", defaultDirection: "desc" },
                },
              ]}
              empty="No ballots have been submitted."
              rowKey={(ballot) => ballot.id}
            />
          )}
        </div>

        <div class="pk-stack pk-stack--snug">
          <div class="pk-cluster">
            <Button size="sm" aria-expanded={showStatistics} onClick={() => setShowStatistics((shown) => !shown)}>
              {showStatistics ? "Hide vote statistics" : "Load vote statistics"}
            </Button>
          </div>
          {showStatistics && (
            <Suspense fallback={<Spinner label="Loading vote statistics…" />}>
              <GroupVoteStatistics groupId={groupId} voteId={vote.id} />
            </Suspense>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
