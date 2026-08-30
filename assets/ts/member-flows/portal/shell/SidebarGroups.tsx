/**
 * The group-centered sidebar: the identity's joined and managed groups,
 * each linking straight into that group's workspace. Joined groups come from
 * the member self-participation projection; managed groups come from the
 * staff manageable-group catalog. Both are server-bounded queries.
 *
 * The list deliberately shows names only: the menu navigates, it does not
 * explain authority. What an identity may do in a group is expressed by the
 * workspace itself, and the identity's roles live in the account view.
 */
import { signal } from "@preact/signals";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import type { Group } from "../../../../shared/schemas/groups";
import { groupsListResponseSchema } from "../../../../shared/schemas/groups";
import { selfGroupsListResponseSchema, type SelfGroup } from "../../../../shared/schemas/group-participation";
import { Spinner } from "../../../components/Spinner";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import type { PortalSession } from "../types";

const SIDEBAR_GROUP_LIMIT = 12;

const portalGroupsVersion = signal(0);

/** Call after a join/leave/create so the sidebar reflects the new membership state. */
export function refreshPortalSidebarGroups(): void {
  portalGroupsVersion.value += 1;
}

export interface SidebarGroupEntry {
  id: string;
  name: string;
  parentGroupId: string | null;
  parentGroupName: string | null;
}

export interface SidebarGroupNode extends SidebarGroupEntry {
  children: SidebarGroupNode[];
  /** Set when the parent exists but is not itself in the list. */
  parentContext: string | null;
}

/** Joined groups first in their server order, then manage-only groups. */
export function mergeSidebarGroups(joined: readonly SelfGroup[], manageable: readonly Group[]): SidebarGroupEntry[] {
  const entries = new Map<string, SidebarGroupEntry>();
  const toEntry = (group: SelfGroup | Group): SidebarGroupEntry => ({
    id: group.id,
    name: group.name,
    parentGroupId: group.parentGroup?.id ?? null,
    parentGroupName: group.parentGroup?.name ?? null,
  });
  for (const group of joined) {
    entries.set(group.id, toEntry(group));
  }
  for (const group of manageable) {
    if (!entries.has(group.id)) {
      entries.set(group.id, toEntry(group));
    }
  }
  return [...entries.values()];
}

/**
 * Groups form a hierarchy; the sidebar mirrors it for the entries present.
 * A child whose parent is listed nests beneath it; a child whose parent is
 * absent stays top-level and names its parent as context instead.
 */
export function buildSidebarGroupForest(entries: readonly SidebarGroupEntry[]): SidebarGroupNode[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const nodes = new Map<string, SidebarGroupNode>(
    entries.map((entry) => [
      entry.id,
      {
        ...entry,
        children: [],
        parentContext: entry.parentGroupId && !byId.has(entry.parentGroupId) ? entry.parentGroupName : null,
      },
    ]),
  );
  const roots: SidebarGroupNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id)!;
    const parent = entry.parentGroupId ? nodes.get(entry.parentGroupId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // A cycle would keep every involved node out of `roots`; surface them
  // top-level instead of silently dropping them.
  const reachable = new Set<string>();
  const walk = (node: SidebarGroupNode): void => {
    if (reachable.has(node.id)) return;
    reachable.add(node.id);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  for (const node of nodes.values()) {
    if (!reachable.has(node.id)) {
      roots.push(node);
      walk(node);
    }
  }
  return roots;
}

export function SidebarGroups({ session, onNavigate }: { session: PortalSession | null; onNavigate: () => void }) {
  const [location] = useHashLocation();
  const version = portalGroupsVersion.value;
  const joined = useData(
    () =>
      session?.member
        ? getJson(`/api/v1/users/current/groups?view=joined&limit=${SIDEBAR_GROUP_LIMIT}`, selfGroupsListResponseSchema)
        : Promise.resolve(null),
    [Boolean(session?.member), version],
  );
  const manageable = useData(
    () =>
      session?.staff
        ? getJson(`/api/v1/groups?manageable=true&sort=name&limit=${SIDEBAR_GROUP_LIMIT}`, groupsListResponseSchema)
        : Promise.resolve(null),
    [Boolean(session?.staff), version],
  );

  if (!session?.member && !session?.staff) return null;
  if (joined.loading || manageable.loading) {
    return (
      <div class="portal-sidebar-groups" aria-hidden="true">
        <Spinner />
      </div>
    );
  }

  const entries = mergeSidebarGroups(joined.data?.groups ?? [], manageable.data?.groups ?? []);
  if (entries.length === 0) return null;
  const visible = entries.slice(0, SIDEBAR_GROUP_LIMIT);
  const truncated =
    entries.length > visible.length || Boolean(joined.data?.page.hasMore) || Boolean(manageable.data?.page.hasMore);
  const forest = buildSidebarGroupForest(visible);

  const renderNode = (node: SidebarGroupNode) => {
    const path = `/groups/${encodeURIComponent(node.id)}`;
    const active = location === path || location.startsWith(`${path}/`);
    return (
      <li key={node.id}>
        <Link href={path} class={`portal-sidebar-group${active ? " active" : ""}`} onClick={onNavigate}>
          {node.parentContext && <span class="portal-sidebar-group-context">{node.parentContext}</span>}
          <span class="portal-sidebar-group-name">{node.name}</span>
        </Link>
        {node.children.length > 0 && <ul class="portal-sidebar-subgroups">{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <ul class="portal-sidebar-groups" aria-label="Your groups">
      {forest.map(renderNode)}
      {truncated && (
        <li>
          <Link href="/groups" class="portal-sidebar-group portal-sidebar-group-more" onClick={onNavigate}>
            All groups…
          </Link>
        </li>
      )}
    </ul>
  );
}
