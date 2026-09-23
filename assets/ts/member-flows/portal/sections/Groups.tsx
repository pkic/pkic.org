/** Generic self-service participation view shared by every configured group type. */
import { useEffect, useRef } from "preact/hooks";
import type { z } from "zod";
import { usePortalHashLocation } from "../hash-location";
import { groupSchema, groupsListResponseSchema } from "../../../../shared/schemas/groups";
import { selfGroupsListResponseSchema, type SelfGroup } from "../../../../shared/schemas/group-participation";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { RowActions } from "../../../ui/RowActions";
import type { MenuItem } from "../../../ui/Menu";
import { Badge } from "../../../components/Badge";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../ui/PageHeader";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalSession } from "../state";
import { refreshPortalSidebarGroups } from "../shell/SidebarGroups";
import { GroupCreateForm } from "./management/GroupCreateForm";
import {
  affiliationLabel,
  availableCapacities,
  joinGroupOnBehalf,
  leaveGroupAsCapacity,
  leaveGroupEntirely,
} from "./group-participation-commands";
import { fmtDate } from "../ui";
import { TableCodedLabel } from "../../../ui/TableCodedLabel";

type SelfGroupsPage = z.infer<typeof selfGroupsListResponseSchema>;
type Group = z.infer<typeof groupSchema>;

/** Reserved group-id segment that routes to the creation page instead of a group's workspace. */
const NEW_GROUP_SEGMENT = "new";

const GROUPS_PATH = "/groups";

/** Redirects back to the catalog from an effect, not render — see its call site below. */
function GroupsRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => navigate(GROUPS_PATH), [navigate]);
  return null;
}

/**
 * The groups a member can join, as a table (#51).
 *
 * It was a column of cards, one per group, each carrying the group's name and
 * description, a checkbox for every affiliation the reader represents and a
 * "Join selected" button. Ten groups meant ten open forms stacked down a page
 * that could not be sorted, searched or paged like every other list in the
 * portal — and the decision each of them offered is one a reader makes rarely
 * and takes whole.
 *
 * So it is the same `ApiDataTable` the rest of the portal uses, and joining is
 * a command on the row. What the card asked with checkboxes standing open, the
 * command asks in its confirmation: on whose behalf.
 */
function MemberGroupCatalog({ onCreate }: { onCreate?: () => void }) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [, navigate] = usePortalHashLocation();

  async function afterChange(changed: boolean): Promise<void> {
    if (!changed) return;
    refreshPortalSidebarGroups();
    await tableRef.current?.reload();
  }

  /**
   * What can be done to one row. Joining is offered only where there is
   * something left to join with, and leaving names the affiliation it ends —
   * "Leave" alone would be ambiguous for a reader who represents three.
   */
  function participationActions(group: SelfGroup): MenuItem[] {
    const available = availableCapacities(group);
    const joined = group.memberships.length > 0;
    const items: MenuItem[] = [];

    if (available.length > 0) {
      items.push({
        id: "join",
        label: joined ? "Join on behalf of…" : "Join group…",
        onSelect: () => void joinGroupOnBehalf(group).then(afterChange),
      });
    }
    if (joined) {
      items.push({
        id: "meetings",
        label: "Meetings and calendar",
        // A menu item is a command, not a link: navigation goes through the
        // portal's own router rather than a bare href the menu cannot render.
        onSelect: () => navigate(`${GROUPS_PATH}/${encodeURIComponent(group.id)}/meetings`),
      });
      for (const membership of group.memberships) {
        const label = affiliationLabel({
          memberId: membership.memberId,
          memberType: membership.memberType,
          organizationName: membership.organizationName,
          membershipCategory: membership.membershipCategory,
        });
        items.push({
          id: `leave-${membership.memberId}`,
          label: `Stop participating as ${label}…`,
          danger: true,
          separatorBefore: items.length > 0,
          onSelect: () => void leaveGroupAsCapacity(group, membership.memberId, label).then(afterChange),
        });
      }
    }
    if (group.memberships.length > 1) {
      items.push({
        id: "leave-all",
        label: "Leave for every affiliation…",
        danger: true,
        onSelect: () => void leaveGroupEntirely(group).then(afterChange),
      });
    }
    return items;
  }

  return (
    <ApiDataTable
      caption="Groups you can join"
      createAction={onCreate ? { label: "New group", onSelect: onCreate } : undefined}
      urlState="catalog"
      endpoint="/api/v1/users/current/groups"
      params={{ view: "catalog" }}
      responseSchema={selfGroupsListResponseSchema}
      resolve={(response: SelfGroupsPage) => response.groups}
      resolvePage={(response: SelfGroupsPage) => response.page}
      paginate
      initialSort="name"
      searchPlaceholder="Search groups…"
      actionsRef={tableRef}
      rowKey={(group: SelfGroup) => group.id}
      columns={[
        {
          header: "Group",
          cell: (group: SelfGroup) => (
            <div>
              <TableCodedLabel code={group.abbreviatedName} name={group.name} wideCode className="pk-strong" />
              <div class="pk-small pk-muted">
                {group.type.singularLabel}
                {group.parentGroup ? ` · part of ${group.parentGroup.name}` : ""}
              </div>
            </div>
          ),
          sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
          width: "primary",
        },
        {
          /*
           * Membership is per affiliation, so the column says which — an
           * em dash where none participate, rather than an empty cell that
           * reads as missing data.
           */
          header: "Participating as",
          cell: (group: SelfGroup) =>
            group.memberships.length === 0 ? (
              <span class="pk-muted">—</span>
            ) : (
              <ul class="pk-stack pk-stack--tight">
                {group.memberships.map((membership) => (
                  <li key={membership.id}>
                    {affiliationLabel({
                      memberId: membership.memberId,
                      memberType: membership.memberType,
                      organizationName: membership.organizationName,
                      membershipCategory: membership.membershipCategory,
                    })}{" "}
                    <span class="pk-small pk-muted">since {fmtDate(membership.joinedAt)}</span>
                  </li>
                ))}
              </ul>
            ),
        },
        {
          // The row's own commands, where every other table in the portal
          // keeps them.
          header: "",
          cell: (group: SelfGroup) => <RowActions subject={group.name} actions={participationActions(group)} />,
          width: "fit",
        },
      ]}
      empty={<EmptyState title="No groups are available right now." />}
      rowAction={(group: SelfGroup) => ({
        label: `Open ${group.name}`,
        href: `#/groups/${encodeURIComponent(group.id)}/overview`,
      })}
    />
  );
}

function AllGroups({ canCreate, onCreate }: { canCreate: boolean; onCreate?: () => void }) {
  return (
    <ApiDataTable
      caption="All groups"
      createAction={onCreate ? { label: "New group", onSelect: onCreate } : undefined}
      urlState="groups"
      endpoint="/api/v1/groups"
      responseSchema={groupsListResponseSchema}
      resolve={(response) => response.groups}
      resolvePage={(response) => response.page}
      paginate
      initialSort="name"
      searchPlaceholder="Search groups…"
      columns={[
        {
          header: "Group",
          cell: (group: Group) => (
            <div>
              <TableCodedLabel code={group.abbreviatedName} name={group.name} wideCode className="pk-strong" />
              <div class="pk-small">{group.type.singularLabel}</div>
            </div>
          ),
          sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
        },
        {
          header: "Status",
          /*
           * An active group used to be a faint dash and nothing else — a
           * status carried by looking quiet, which a screen reader cannot
           * hear. The dash stays as the visual, and the word goes beside
           * it for anyone not reading the greys.
           */
          cell: (group: Group) =>
            group.active ? (
              <>
                <span class="pk-muted" aria-hidden="true">
                  —
                </span>
                <span class="pk-sr-only">Active</span>
              </>
            ) : (
              <Badge status="inactive" />
            ),
          width: "fit",
          // The contract already accepts `active`; the column it shows in is
          // where the reader narrows by it, rather than a select above the
          // table that left inactive groups a concept to infer from the badge.
          filter: {
            param: "active",
            options: [
              { value: "", label: "All statuses" },
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" },
            ],
          },
        },
      ]}
      empty={
        canCreate ? (
          <EmptyState title="No groups yet" body="Create a group to get started." />
        ) : (
          "No groups are visible to your identity."
        )
      }
      rowKey={(group: Group) => group.id}
      rowAction={(group: Group) => ({
        label: `Open ${group.name}`,
        href: `#/groups/${encodeURIComponent(group.id)}/overview`,
      })}
    />
  );
}

/**
 * Portal route adapter for the groups surface: the catalog, and — under the
 * reserved `new` segment — the create page. Creation is a place with its own
 * address, so it survives a reload and the browser's Back button closes it.
 */
export function Groups({
  groupSegment,
}: {
  /** `undefined` for the catalog, `"new"` for the create page. */
  groupSegment?: string;
} = {}) {
  const [, navigate] = usePortalHashLocation();
  const session = portalSession.value;
  const canCreateGroups = portalHasGlobalPermission(session, "groups:write");

  function openCreatePage(): void {
    navigate(`${GROUPS_PATH}/${NEW_GROUP_SEGMENT}`);
  }

  if (groupSegment === NEW_GROUP_SEGMENT) {
    // Navigating away belongs in an effect, not in render.
    if (!canCreateGroups) return <GroupsRedirect navigate={navigate} />;
    return (
      <div class="pk pk-stack content-width-schedule">
        {/* The create page opens like every other page below a section root:
            a trail back to the catalog and the page's own subject. */}
        <PageHeader
          trail={[{ label: "Groups", href: usePortalHashLocation.hrefs(GROUPS_PATH) }, { label: "Create a group" }]}
          title="Create a group"
        />
        <GroupCreateForm
          onCreated={(created) => {
            refreshPortalSidebarGroups();
            navigate(`${GROUPS_PATH}/${encodeURIComponent(created.id)}/settings`);
          }}
          onCancel={() => navigate(GROUPS_PATH)}
        />
      </div>
    );
  }

  return (
    // No width cap: a list page fills the measure it is given, and the slack
    // lands in the table's primary column rather than in page margins.
    <div class="pk pk-stack">
      <PageHeader title="Groups" />
      {session?.member && <MemberGroupCatalog onCreate={canCreateGroups ? openCreatePage : undefined} />}
      {session?.staff && !session.member && (
        <AllGroups canCreate={canCreateGroups} onCreate={canCreateGroups ? openCreatePage : undefined} />
      )}
    </div>
  );
}
