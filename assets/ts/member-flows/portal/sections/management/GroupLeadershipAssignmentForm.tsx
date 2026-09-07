import { useState } from "preact/hooks";
import {
  defaultGroupLeadershipTitle,
  groupLeadershipAssignSchema,
  groupLeadershipCandidatesListResponseSchema,
  groupLeadershipListResponseSchema,
  type GroupLeadershipCandidate,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitles,
} from "../../../../../shared/schemas/groups";
import { EnumSelect } from "../../../../components/EnumSelect";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { GroupLeadershipTitleInput } from "./GroupLeadershipTermForm";
import { capacityLabel, groupLeadershipRoleOptions } from "./group-leadership";

function candidateLabel(candidate: GroupLeadershipCandidate): string {
  return `${candidate.userName} — ${capacityLabel(candidate)}`;
}

/**
 * Who may be appointed, which is not the same list as who is seated.
 *
 * This read the group's own membership roster, so a group whose participation
 * follows from affiliation rather than from a taken seat — the consortium's
 * All Members forum — offered nobody at all and answered "no matches" for
 * people the system knows (issue #26). The candidates endpoint answers the
 * question the form is actually asking.
 */
function leadershipCandidateCatalog(groupId: string): ServerCatalog<GroupLeadershipCandidate, unknown> {
  return {
    endpoint: `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/candidates`,
    sort: "user_name",
    responseSchema: groupLeadershipCandidatesListResponseSchema,
    resolveItems: (response) => groupLeadershipCandidatesListResponseSchema.parse(response).candidates,
    resolvePage: (response) => groupLeadershipCandidatesListResponseSchema.parse(response).page,
    itemKey: (candidate) => candidate.identityId,
    itemLabel: candidateLabel,
  };
}

/**
 * Assigns a leadership term to someone already participating in the group.
 * The title follows the chosen role's default until the manager types their
 * own; the term starts today unless backdated, and an end date in the past
 * records history rather than granting anything.
 */
export function GroupLeadershipAssignmentForm({
  groupId,
  titles,
  onAssigned,
  onCancel,
}: {
  groupId: string;
  titles: GroupLeadershipTitles;
  onAssigned: () => Promise<void>;
  onCancel: () => void;
}) {
  const [candidate, setCandidate] = useState<GroupLeadershipCandidate | null>(null);
  const [roleId, setRoleId] = useState<GroupLeadershipRoleId>("role-group_lead");
  const [title, setTitle] = useState(defaultGroupLeadershipTitle(titles, "role-group_lead"));
  const [titleEdited, setTitleEdited] = useState(false);
  const [startsOn, setStartsOn] = useState(toCalendarDateInput(new Date().toISOString()));
  const [endsOn, setEndsOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectRole(next: GroupLeadershipRoleId): void {
    setRoleId(next);
    if (!titleEdited) setTitle(defaultGroupLeadershipTitle(titles, next));
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // `loading` keeps the submit button focusable rather than disabled, so the
    // guard against a second submission lives here instead of in the markup.
    if (saving || !candidate) return;
    setSaving(true);
    setError(null);
    try {
      const input = groupLeadershipAssignSchema.parse({
        userId: candidate.userId,
        identityId: candidate.identityId,
        roleId,
        title: title.trim(),
        startsAt: fromCalendarDateInput(startsOn) ?? undefined,
        endsAt: fromCalendarDateInput(endsOn),
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership`,
        input,
        groupLeadershipListResponseSchema,
      );
      await onAssigned();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not add this leadership term.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the leadership panel, so its heading is one rung below
    // that panel's rather than another <h3> beside it.
    <Panel class="pk" aria-label="Add leadership">
      <PanelHeader title="Add leadership" headingLevel={4}>
        {onCancel && (
          <Button size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submit(event)}>
          <p class="pk-muted pk-small">
            Choose a person and the Member they lead on behalf of. An end date in the past records a former term without
            granting access.
          </p>
          {/* Said before the manager commits, not discovered afterwards on the
              Members tab: a leader participates, so appointing somebody the
              group has not seated yet also seats them. */}
          {candidate && !candidate.participating && (
            <p class="pk-muted pk-small">
              {candidate.userName} does not participate in this group yet, and will be added to it by this assignment.
            </p>
          )}
          {error && <ErrorAlert error={error} />}
          {/* One disabled attribute takes the whole group out of play while the
              assignment is in flight, including the search select's own
              controls, which no prop of this form reaches. */}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
            <Field label="Participant">
              {(control) => (
                <ServerSearchSelect
                  {...control}
                  searchLabel="Participant"
                  catalog={leadershipCandidateCatalog(groupId)}
                  value={candidate?.identityId ?? null}
                  selectedLabel={candidate ? candidateLabel(candidate) : undefined}
                  placeholder="Select a person and Member capacity…"
                  searchPlaceholder="Search name, email, or organization…"
                  onChange={setCandidate}
                  disabled={saving}
                />
              )}
            </Field>
            <Field label="Role">
              {(control) => (
                <EnumSelect
                  {...control}
                  value={roleId}
                  onChange={selectRole}
                  options={groupLeadershipRoleOptions(titles)}
                  disabled={saving}
                />
              )}
            </Field>
            <Field label="Title" required>
              {(control) => (
                <GroupLeadershipTitleInput
                  {...control}
                  titles={titles}
                  roleId={roleId}
                  value={title}
                  disabled={saving}
                  onChange={(next) => {
                    setTitle(next);
                    setTitleEdited(true);
                  }}
                />
              )}
            </Field>
            <Field label="Term starts" required>
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={startsOn}
                  onInput={(event) => setStartsOn((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label="Term ends" help="Optional. An end date in the past records a former term.">
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={endsOn}
                  min={startsOn || undefined}
                  onInput={(event) => setEndsOn((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
          </fieldset>
          <div class="pk-cluster">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={saving}
              disabled={!candidate || !title.trim() || !startsOn}
            >
              {saving ? "Adding…" : "Assign leadership"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
