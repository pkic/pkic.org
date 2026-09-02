import { useState } from "preact/hooks";
import {
  defaultGroupLeadershipTitle,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  groupMembershipsManagementListResponseSchema,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitles,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { EnumSelect } from "../../../../components/EnumSelect";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { GroupLeadershipTitleInput } from "./GroupLeadershipTermForm";
import { capacityLabel, groupLeadershipRoleOptions } from "./group-leadership";

function participantLabel(membership: GroupMembership): string {
  return `${membership.userName} — ${capacityLabel(membership)}`;
}

function leadershipCapacityCatalog(groupId: string): ServerCatalog<GroupMembership, unknown> {
  return {
    endpoint: `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    params: { active: "true" },
    sort: "user_name",
    responseSchema: groupMembershipsManagementListResponseSchema,
    resolveItems: (response) => groupMembershipsManagementListResponseSchema.parse(response).memberships,
    resolvePage: (response) => groupMembershipsManagementListResponseSchema.parse(response).page,
    itemKey: (membership) => membership.id,
    itemLabel: participantLabel,
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
  const [membership, setMembership] = useState<GroupMembership | null>(null);
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
    if (!membership) return;
    setSaving(true);
    setError(null);
    try {
      const input = groupLeadershipAssignSchema.parse({
        userId: membership.userId,
        identityId: membership.identityId,
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
    <form class="border rounded p-3 d-flex flex-column gap-3 bg-light" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Add leadership</h6>
        <p class="text-muted small mb-0">
          Choose a participant and the Member they lead on behalf of. An end date in the past records a former term
          without granting access.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <div class="row g-3">
        <div class="col-lg-6">
          <ServerSearchSelect
            catalog={leadershipCapacityCatalog(groupId)}
            label="Participant"
            value={membership?.id ?? null}
            selectedLabel={membership ? participantLabel(membership) : undefined}
            placeholder="Select a person and Member capacity…"
            searchPlaceholder="Search name, email, organization, or category…"
            onChange={setMembership}
            disabled={saving}
          />
        </div>
        <div class="col-lg-3">
          <EnumSelect
            id="managed-group-leadership-role"
            label="Role"
            value={roleId}
            onChange={selectRole}
            options={groupLeadershipRoleOptions(titles)}
            disabled={saving}
            size="md"
          />
        </div>
        <div class="col-lg-3">
          <GroupLeadershipTitleInput
            id="managed-group-leadership-title"
            titles={titles}
            roleId={roleId}
            value={title}
            disabled={saving}
            onChange={(next) => {
              setTitle(next);
              setTitleEdited(true);
            }}
          />
        </div>
        <div class="col-sm-6 col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-leadership-starts">
            Term starts
          </label>
          <input
            id="managed-group-leadership-starts"
            class="form-control"
            type="date"
            required
            value={startsOn}
            disabled={saving}
            onInput={(event) => setStartsOn((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-sm-6 col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-leadership-ends">
            Term ends <span class="text-muted fw-normal">(optional)</span>
          </label>
          <input
            id="managed-group-leadership-ends"
            class="form-control"
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            disabled={saving}
            onInput={(event) => setEndsOn((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <FormActions
        submitLabel="Assign leadership"
        busyLabel="Adding…"
        busy={saving}
        disabled={!membership || !title.trim() || !startsOn}
        onCancel={onCancel}
      />
    </form>
  );
}
