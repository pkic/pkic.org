import { useState } from "preact/hooks";
import {
  GROUP_LEADERSHIP_ROLE_IDS,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  groupMembershipsManagementListResponseSchema,
  type GroupLeadershipAssignment,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { GROUP_LEADERSHIP_ROLE_LABELS } from "./group-leadership";

function capacityLabel(membership: GroupMembership): string {
  const capacity =
    membership.memberType === "organization"
      ? (membership.organizationName ?? "Organization")
      : `Individual membership${membership.membershipCategory ? ` (${membership.membershipCategory})` : ""}`;
  return `${membership.userName} — ${capacity}`;
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
    itemLabel: capacityLabel,
  };
}

export function GroupLeadershipAssignmentForm({
  groupId,
  onAssigned,
  onCancel,
}: {
  groupId: string;
  onAssigned: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [membership, setMembership] = useState<GroupMembership | null>(null);
  const [roleId, setRoleId] = useState<GroupLeadershipAssignment["roleId"]>("role-group_lead");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // `loading` keeps the submit button focusable rather than disabled, so the
    // guard against a second submission lives here instead of in the markup.
    if (saving || !membership) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = groupLeadershipAssignSchema.parse({
        userId: membership.userId,
        identityId: membership.identityId,
        roleId,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership`,
        input,
        groupLeadershipListResponseSchema,
      );
      setMembership(null);
      setExpiresAt("");
      await onAssigned();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not add this leadership assignment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the leadership panel, so its heading is one rung below
    // that panel's rather than another <h3> beside it.
    <Panel class="pk" aria-label="Add local leadership">
      <PanelHeader title="Add local leadership" headingLevel={4}>
        {onCancel && (
          <Button size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submit(event)}>
          <p class="pk-muted pk-small">
            Local assignments extend inherited leadership. An optional expiry ends the assignment automatically.
          </p>
          {error && <ErrorAlert error={error} />}
          {saved && <Alert tone="ok">Leadership assignment added.</Alert>}
          {/* One disabled attribute takes the whole group out of play while the
              assignment is in flight, including the search select's own
              controls, which no prop of this form reaches. */}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
            <ServerSearchSelect
              catalog={leadershipCapacityCatalog(groupId)}
              label="Participation capacity"
              value={membership?.id ?? null}
              selectedLabel={membership ? capacityLabel(membership) : undefined}
              placeholder="Select a person and Member capacity…"
              searchPlaceholder="Search name, email, organization, or category…"
              onChange={setMembership}
              disabled={saving}
            />
            <Field label="Role">
              {(control) => (
                <Select
                  {...control}
                  value={roleId}
                  onChange={(event) =>
                    setRoleId((event.target as HTMLSelectElement).value as GroupLeadershipAssignment["roleId"])
                  }
                >
                  {GROUP_LEADERSHIP_ROLE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {GROUP_LEADERSHIP_ROLE_LABELS[id]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Expires" help="Optional. Leave blank for an assignment that does not end.">
              {(control) => (
                <TextInput
                  {...control}
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(event) => setExpiresAt((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!membership}>
              {saving ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
