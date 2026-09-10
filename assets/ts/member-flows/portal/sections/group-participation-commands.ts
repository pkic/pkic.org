/**
 * Joining and leaving a group, wherever it is asked for.
 *
 * A member participates in a group *on behalf of* the memberships they
 * represent — an organization, or their own individual membership — so every
 * one of these commands has a scope as well as a subject. The scope used to
 * be a column of checkboxes standing open on every card in the catalog, which
 * put three controls and a button on screen for a decision most readers make
 * once and take whole (#51). It is asked for in the dialog that confirms the
 * command instead: same moment, one place.
 *
 * The commands live here rather than in either surface because both the
 * catalog and a group's own page offer them, and two copies of "what joining
 * means" is how the two drift.
 */
import { confirmAction, confirmSelection } from "../../../components/ConfirmDialog";
import { groupMembershipMutationResponseSchema } from "../../../../shared/schemas/groups";
import type { GroupParticipationCapacity, SelfGroup } from "../../../../shared/schemas/group-participation";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { toast } from "../ui";

/** What a capacity is called where a reader has to choose between them. */
export function affiliationLabel(capacity: GroupParticipationCapacity): string {
  return capacity.organizationName ?? `Individual membership (${capacity.membershipCategory})`;
}

/** The memberships this reader could still join a group on behalf of. */
export function availableCapacities(group: SelfGroup): GroupParticipationCapacity[] {
  const joined = new Set(group.memberships.map((membership) => membership.memberId));
  return group.eligibleCapacities.filter((capacity) => !joined.has(capacity.memberId));
}

async function mutate(group: SelfGroup, path: "join" | "leave", body: unknown, success: string): Promise<boolean> {
  try {
    await postJson(`/api/v1/groups/${group.id}/${path}`, body, groupMembershipMutationResponseSchema);
    toast(success, "success");
    return true;
  } catch (error) {
    toast(error instanceof ApiClientError ? error.message : `Could not ${path} this group.`, "error");
    return false;
  }
}

/**
 * Joins a group, asking on whose behalf.
 *
 * With one eligible membership there is nothing to choose, so it confirms
 * rather than offering a list of one. Resolves false when the reader backs
 * out, so a caller does not reload a list that did not change.
 */
export async function joinGroupOnBehalf(group: SelfGroup): Promise<boolean> {
  const available = availableCapacities(group);
  if (available.length === 0) return false;

  const alreadyIn = group.memberships.length > 0;
  const title = alreadyIn ? `Join ${group.name} on behalf of another affiliation?` : `Join ${group.name}?`;

  let memberIds: string[];
  if (available.length === 1) {
    const only = available[0];
    const confirmed = await confirmAction({
      title,
      body: `You will participate on behalf of ${affiliationLabel(only)}.`,
      confirmLabel: "Join group",
      tone: "primary",
    });
    if (!confirmed) return false;
    memberIds = [only.memberId];
  } else {
    const chosen = await confirmSelection({
      title,
      body: "You represent more than one membership. Choose which of them join.",
      confirmLabel: "Join group",
      tone: "primary",
      choices: available.map((capacity) => ({
        id: capacity.memberId,
        label: affiliationLabel(capacity),
        legend: "Join on behalf of",
      })),
    });
    if (chosen === null || chosen.length === 0) return false;
    memberIds = chosen;
  }

  /*
   * "Every eligible membership" is its own mode, and the server treats it as a
   * deliberate blanket choice rather than a list that happened to be complete
   * — which matters when a reader gains an affiliation later.
   */
  const capacitySelection =
    !alreadyIn && memberIds.length === available.length
      ? ({ mode: "all_eligible", confirmed: true } as const)
      : ({ mode: "selected", memberIds } as const);

  return mutate(group, "join", { capacitySelection }, `Joined ${group.name}`);
}

/** Stops one membership participating, named in the confirmation. */
export async function leaveGroupAsCapacity(group: SelfGroup, memberId: string, label: string): Promise<boolean> {
  const confirmed = await confirmAction({
    title: `Stop participating in ${group.name} on behalf of ${label}?`,
    consequences: [`${label} loses this group's access`, `You can rejoin ${group.name} on their behalf later`],
    confirmLabel: "Stop participating",
    tone: "danger",
  });
  if (!confirmed) return false;
  return mutate(group, "leave", { mode: "selected", memberIds: [memberId] }, `Updated ${group.name} participation`);
}

/** Leaves for every affiliation at once. */
export async function leaveGroupEntirely(group: SelfGroup): Promise<boolean> {
  const confirmed = await confirmAction({
    title: `Leave ${group.name} for every affiliation?`,
    consequences: ["Every affiliation loses this group's access", `You can rejoin ${group.name} later`],
    confirmLabel: "Leave group",
    tone: "danger",
  });
  if (!confirmed) return false;
  return mutate(group, "leave", { mode: "all" }, `Left ${group.name}`);
}
