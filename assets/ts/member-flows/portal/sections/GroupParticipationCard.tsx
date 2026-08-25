import { useEffect, useState } from "preact/hooks";
import type { GroupParticipationCapacity, SelfGroup } from "../../../../shared/schemas/group-participation";
import { groupMembershipMutationResponseSchema } from "../../../../shared/schemas/groups";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { fmt, toast } from "../ui";

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
    if (!confirm(`Stop participating in ${group.name} on behalf of ${label}?`)) return;
    await mutate("leave", { mode: "selected", memberIds: [memberId] }, `Updated ${group.name} participation`);
  }

  async function leaveAll(): Promise<void> {
    if (!confirm(`Leave ${group.name} for every affiliation?`)) return;
    await mutate("leave", { mode: "all" }, `Left ${group.name}`);
  }

  return (
    <article class="card border-0 shadow-sm">
      <div class="card-body d-flex flex-column gap-3">
        <div>
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">{group.name}</span>
            <span class="badge text-bg-secondary">{group.type.singularLabel}</span>
            {group.memberships.length > 0 && <span class="badge text-bg-success">Joined</span>}
          </div>
          {group.parentGroup && <p class="text-muted small mb-0 mt-1">Part of {group.parentGroup.name}</p>}
          {group.description && <p class="text-muted small mb-0 mt-1">{group.description}</p>}
        </div>

        {group.memberships.length > 0 && (
          <div>
            <p class="small fw-semibold mb-1">Participating as</p>
            <ul class="list-unstyled d-flex flex-column gap-1 mb-0">
              {group.memberships.map((membership) => {
                const label = affiliationLabel({
                  memberId: membership.memberId,
                  memberType: membership.memberType,
                  organizationName: membership.organizationName,
                  membershipCategory: membership.membershipCategory,
                });
                return (
                  <li key={membership.id} class="d-flex align-items-center justify-content-between gap-2 small">
                    <span>
                      {label} <span class="text-muted">since {fmt(membership.joinedAt)}</span>
                    </span>
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-danger"
                      disabled={busy}
                      onClick={() => void removeCapacity(membership.memberId, label)}
                      aria-label={`Stop participating in ${group.name} on behalf of ${label}`}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {available.length > 0 && (
          <fieldset disabled={busy} class="border-0 p-0 m-0">
            <legend class="small fw-semibold mb-1">
              {group.memberships.length > 0 ? "Add another affiliation" : "Join on behalf of"}
            </legend>
            {available.map((capacity) => {
              const label = affiliationLabel(capacity);
              const controlId = `group-${group.id}-capacity-${capacity.memberId}`;
              return (
                <div class="form-check" key={capacity.memberId}>
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id={controlId}
                    checked={selected.has(capacity.memberId)}
                    onChange={() => toggle(capacity.memberId)}
                  />
                  <label class="form-check-label small" for={controlId}>
                    {label}
                  </label>
                </div>
              );
            })}
          </fieldset>
        )}

        <div class="d-flex flex-wrap gap-2">
          {group.memberships.length > 0 && (
            <a href={`#/groups/${encodeURIComponent(group.id)}/meetings`} class="btn btn-sm btn-outline-secondary">
              Meetings and calendar
            </a>
          )}
          {available.length > 0 && (
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              disabled={busy || selected.size === 0}
              onClick={() => void joinSelected()}
            >
              {busy ? "Saving…" : group.memberships.length > 0 ? "Add selected" : "Join selected"}
            </button>
          )}
          {group.memberships.length > 1 && (
            <button type="button" class="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void leaveAll()}>
              Leave all
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
