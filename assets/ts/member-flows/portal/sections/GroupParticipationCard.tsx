/**
 * One group in the participation catalog: what the group is, which of the
 * viewer's affiliations already participate, which ones could, and the joins
 * and leaves available from here. Every mutation goes through the shared
 * join/leave endpoints; the card never edits its own copy of the group.
 */
import { useEffect, useState } from "preact/hooks";
import type { GroupParticipationCapacity, SelfGroup } from "../../../../shared/schemas/group-participation";
import { groupMembershipMutationResponseSchema } from "../../../../shared/schemas/groups";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { confirmAction } from "../../../components/ConfirmDialog";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { RowActions } from "../../../ui/RowActions";
import { fmtDate, toast } from "../ui";

function affiliationLabel(capacity: GroupParticipationCapacity): string {
  return capacity.organizationName ?? `Individual membership (${capacity.membershipCategory})`;
}

export function GroupParticipationCard({ group, onChanged }: { group: SelfGroup; onChanged: () => Promise<void> }) {
  const joinedMemberIds = new Set(group.memberships.map((membership) => membership.memberId));
  const available = group.eligibleCapacities.filter((capacity) => !joinedMemberIds.has(capacity.memberId));
  const availableKey = available.map((capacity) => capacity.memberId).join(",");
  const [selected, setSelected] = useState(() => new Set(available.map((capacity) => capacity.memberId)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(new Set(available.map((capacity) => capacity.memberId)));
  }, [availableKey]);

  function toggle(memberId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function mutate(path: "join" | "leave", body: unknown, successMessage: string): Promise<void> {
    setBusy(true);
    try {
      await postJson(`/api/v1/groups/${group.id}/${path}`, body, groupMembershipMutationResponseSchema);
      toast(successMessage, "success");
      await onChanged();
    } catch (error) {
      toast(error instanceof ApiClientError ? error.message : `Could not ${path} this group.`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function joinSelected(): Promise<void> {
    const memberIds = [...selected];
    if (memberIds.length === 0) return;
    const allUnjoinedSelected = memberIds.length === available.length;
    const capacitySelection =
      group.memberships.length === 0 && allUnjoinedSelected
        ? { mode: "all_eligible" as const, confirmed: true as const }
        : { mode: "selected" as const, memberIds };
    await mutate("join", { capacitySelection }, `Joined ${group.name}`);
  }

  async function removeCapacity(memberId: string, label: string): Promise<void> {
    const confirmed = await confirmAction({
      title: `Stop participating in ${group.name} on behalf of ${label}?`,
      consequences: [`${label} loses this group's access`, `You can rejoin ${group.name} on their behalf later`],
      confirmLabel: "Stop participating",
      tone: "danger",
    });
    if (!confirmed) return;
    await mutate("leave", { mode: "selected", memberIds: [memberId] }, `Updated ${group.name} participation`);
  }

  async function leaveAll(): Promise<void> {
    const confirmed = await confirmAction({
      title: `Leave ${group.name} for every affiliation?`,
      consequences: ["Every affiliation loses this group's access", `You can rejoin ${group.name} later`],
      confirmLabel: "Leave group",
      tone: "danger",
    });
    if (!confirmed) return;
    await mutate("leave", { mode: "all" }, `Left ${group.name}`);
  }

  const joinLabel = group.memberships.length > 0 ? "Add selected" : "Join selected";

  return (
    <Panel class="pk">
      <PanelHeader title={group.name}>
        <Badge tone="neutral">{group.type.singularLabel}</Badge>
        {group.memberships.length > 0 && <Badge tone="ok">Joined</Badge>}
      </PanelHeader>
      <PanelBody class="pk-stack">
        {(group.parentGroup ?? group.description) != null && (
          <div class="pk-stack pk-stack--tight">
            {group.parentGroup && <p class="pk-small">Part of {group.parentGroup.name}</p>}
            {group.description && <p class="pk-small">{group.description}</p>}
          </div>
        )}

        {group.memberships.length > 0 && (
          <div class="pk-stack pk-stack--snug">
            {/* A heading over a list of affiliations, not the label of a
                control. `pk-field__label` outside a `pk-field` is a part with
                no whole: there is no state here for it to carry. */}
            <p class="pk-small pk-strong">Participating as</p>
            <ul class="pk-stack pk-stack--tight" aria-label={`Affiliations participating in ${group.name}`}>
              {group.memberships.map((membership) => {
                const label = affiliationLabel({
                  memberId: membership.memberId,
                  memberType: membership.memberType,
                  organizationName: membership.organizationName,
                  membershipCategory: membership.membershipCategory,
                });
                return (
                  <li key={membership.id} class="pk-cluster pk-cluster--between">
                    <span>
                      {label} <span class="pk-small">since {fmtDate(membership.joinedAt)}</span>
                    </span>
                    <RowActions
                      label={`Actions for ${label}`}
                      actions={[
                        {
                          id: "remove",
                          label: "Remove",
                          disabled: busy,
                          onSelect: () => void removeCapacity(membership.memberId, label),
                        },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {available.length > 0 && (
          // `pk-field` is the group the legend belongs to: the modifier that
          // carries a validation state is only ever set there, so a legend
          // outside one could never show it.
          <fieldset disabled={busy} class="pk-fieldset pk-field">
            <legend class="pk-field__label">
              {group.memberships.length > 0 ? "Add another affiliation" : "Join on behalf of"}
            </legend>
            <div class="pk-stack pk-stack--snug">
              {available.map((capacity) => {
                const label = affiliationLabel(capacity);
                const controlId = `group-${group.id}-capacity-${capacity.memberId}`;
                return (
                  <label class="pk-check" for={controlId} key={capacity.memberId}>
                    <input
                      class="pk-check__input"
                      type="checkbox"
                      id={controlId}
                      checked={selected.has(capacity.memberId)}
                      onChange={() => toggle(capacity.memberId)}
                    />
                    <span class="pk-check__label">{label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div class="pk-cluster">
          {group.memberships.length > 0 && (
            // A destination, not an action, so it stays an anchor and merely
            // borrows the button's appearance.
            <a href={`#/groups/${encodeURIComponent(group.id)}/meetings`} class="pk-btn pk-btn--secondary pk-btn--sm">
              Meetings and calendar
            </a>
          )}
          {available.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={selected.size === 0}
              onClick={() => void joinSelected()}
            >
              {busy ? "Saving…" : joinLabel}
            </Button>
          )}
          {group.memberships.length > 1 && (
            <Button variant="danger-quiet" size="sm" loading={busy} onClick={() => void leaveAll()}>
              Leave all
            </Button>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
