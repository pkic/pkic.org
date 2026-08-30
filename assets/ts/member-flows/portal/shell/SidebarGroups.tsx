/**
 * The group-centered sidebar: the identity's joined and managed groups,
 * each linking straight into that group's workspace. Joined groups come from
 * the member self-participation projection; managed groups come from the
 * staff manageable-group catalog. Both are server-bounded queries.
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
  isMember: boolean;
  canManage: boolean;
}

/** Joined groups first in their server order, then manage-only groups. */
export function mergeSidebarGroups(joined: readonly SelfGroup[], manageable: readonly Group[]): SidebarGroupEntry[] {
  const entries = new Map<string, SidebarGroupEntry>();
  for (const group of joined) {
    entries.set(group.id, {
      id: group.id,
      name: group.name,
      isMember: group.memberships.length > 0,
      canManage: false,
    });
  }
  for (const group of manageable) {
    const existing = entries.get(group.id);
    if (existing) {
      existing.canManage = true;
    } else {
      entries.set(group.id, { id: group.id, name: group.name, isMember: false, canManage: true });
    }
  }
  return [...entries.values()];
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

  return (
    <ul class="portal-sidebar-groups" aria-label="Your groups">
      {visible.map((entry) => {
        const path = `/groups/${encodeURIComponent(entry.id)}`;
        const active = location === path || location.startsWith(`${path}/`);
        return (
          <li key={entry.id}>
            <Link href={path} class={`portal-sidebar-group${active ? " active" : ""}`} onClick={onNavigate}>
              <span class="portal-sidebar-group-name">{entry.name}</span>
              {entry.canManage && (
                <span class="portal-sidebar-group-role">{entry.isMember ? "member · manages" : "manages"}</span>
              )}
            </Link>
          </li>
        );
      })}
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
