/**
 * What a user may do, said once on their record.
 *
 * The navigation navigates; this panel explains standing. Membership comes
 * from the identities on the record, so staff and the person read the same
 * line. The permission list and sponsor access come from the signed-in
 * session, so only the person themselves sees them here.
 */
import { Link } from "wouter";
import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import type { PortalSession } from "../../types";
import type { UserDetail as UserRecord } from "./model";

function grantScopeLabel(grant: { contextType: string | null; contextId: string | null }): string {
  if (grant.contextType === null) return "global";
  return grant.contextId ? `${grant.contextType} ${grant.contextId}` : grant.contextType;
}

function grantSummary(grants: ReadonlyArray<{ contextType: string | null }>): string {
  const scoped = grants.filter((grant) => grant.contextType !== null).length;
  const count = `${grants.length} ${grants.length === 1 ? "permission" : "permissions"}`;
  if (scoped === 0) return `${count}, all global`;
  if (scoped === grants.length) return `${count}, all scoped`;
  return `${count}, ${grants.length - scoped} global and ${scoped} scoped`;
}

export function UserAccessPanel({ user, session }: { user: UserRecord; session: PortalSession | null }) {
  const memberships = user.identities.filter((identity) => identity.membershipCategory !== null);
  const categories = useMembershipCategoryLabels(memberships.length > 0);
  const staff = session?.staff;
  const sponsors = session?.sponsors ?? [];

  const items: DescriptionListItem[] = [
    {
      term: "Membership",
      value:
        memberships.length === 0 ? (
          "Not a member"
        ) : (
          <ul class="pk-plain-list">
            {memberships.map((membership) => (
              <li key={membership.identityId}>
                {membership.organizationId ? (
                  <Link href={`/organizations/${encodeURIComponent(membership.organizationId)}`}>
                    {membership.organizationName ?? "Organization"}
                  </Link>
                ) : (
                  "Individual"
                )}
                {/* Plain text, not a Badge: a long catalog label must wrap on a phone. */}
                <span class="pk-muted"> — {categories.label(membership.membershipCategory)}</span>
              </li>
            ))}
          </ul>
        ),
    },
  ];

  if (staff) {
    items.push({
      term: "Permissions",
      value:
        staff.grants.length === 0 ? (
          "None"
        ) : (
          <details>
            <summary>{grantSummary(staff.grants)}</summary>
            <ul class="pk-plain-list">
              {staff.grants.map((grant) => (
                <li key={`${grant.permission}:${grant.contextType ?? ""}:${grant.contextId ?? ""}`}>
                  <code>{grant.permission}</code> <span class="pk-muted">{grantScopeLabel(grant)}</span>
                </li>
              ))}
            </ul>
          </details>
        ),
    });
  }

  items.push({ term: "Group roles", value: "Set in each group" });

  if (sponsors.length > 0) {
    items.push({
      term: "Sponsor access",
      value: (
        <ul class="pk-plain-list">
          {sponsors.map((sponsor) => (
            <li key={`${sponsor.sponsorId}:${sponsor.eventId}`}>
              {sponsor.eventName ?? sponsor.eventSlug} <span class="pk-muted">— {sponsor.tier}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }

  return (
    <Panel aria-label="Access">
      <PanelHeader title="Access" headingLevel={2} />
      <PanelBody>
        <DescriptionList density="compact" items={items} />
      </PanelBody>
    </Panel>
  );
}
