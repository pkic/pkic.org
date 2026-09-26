/**
 * Every organization a person is or was tied to, and the controls that manage
 * those ties.
 *
 * One panel, not two. The record previously stated each affiliation in an
 * Organizations panel and then restated the same rows as management cards in a
 * Membership panel below it — the same organization, job title, address, dates
 * and groups in both, with nothing keeping them consistent but the fact that
 * they read from the same object. A tie is one thing; it is stated once and
 * managed where it is stated.
 *
 * Ended ties are kept behind the footer rather than dropped: they are the
 * person's history in the consortium, and history that is deleted from the
 * page is history nobody can check.
 */
import { useState } from "preact/hooks";

import { fmt } from "../../ui";
import { AffiliationRow } from "../../../../ui/AffiliationRow";
import { Avatar } from "../../../../ui/Avatar";
import { EmptyState } from "../../../../ui/EmptyState";
import { ExpandFooter } from "../../../../ui/ExpandFooter";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { UserAffiliationRow } from "./UserAffiliationRow";
import type { UserDetail } from "./model";

export function UserAffiliationsPanel({
  user,
  onChanged,
  canManage,
  summarizedIdentityId,
}: {
  user: UserDetail;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
  /** The identity whose biography the record already states as its About. */
  summarizedIdentityId?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const [historyOpen, setHistoryOpen] = useState(false);

  /*
   * An individual capacity is the end of the line: someone who is a member in
   * their own right holds no further identities, so the grant is withdrawn
   * rather than offered and refused.
   */
  const hasIndividualMembership = user.identities.some((identity) => identity.organizationId === null);
  const formerIdentities = user.formerIdentities;

  return (
    <Panel>
      {/*
        "Affiliations", not "Organizations": a row here is the person's tie to
        a member, and an individual member — a consultant who is a member in
        their own right — has no organization behind theirs. Titling the panel
        after organizations made that row read as an organization named
        "Individual member". The word is the one this panel already used
        everywhere else: its own counter says "affiliation" and its menu is
        "Affiliation settings".
      */}
      <PanelHeader title="Affiliations">
        <span class="pk-small pk-muted">
          {user.identities.length} {user.identities.length === 1 ? "affiliation" : "affiliations"}
        </span>
        {/* The panel's own action lives in its menu rather than as a button in
            the body, where it competed with the ties the panel is about. */}
        {canManage && !hasIndividualMembership && (
          <Menu
            label="Affiliation settings"
            align="end"
            items={[
              {
                // A create action is a page of its own under the record,
                // never a form unfolding inside this panel (#107).
                id: "add",
                label: "Add identity…",
                onSelect: () => navigate(`/users/${encodeURIComponent(user.id)}/affiliations/new`),
              },
            ]}
          />
        )}
      </PanelHeader>

      <PanelBody class="pk-stack">
        {user.identities.length === 0 && (
          <EmptyState
            title="No active identities."
            body="This user can sign in but acts in no membership capacity yet."
          />
        )}

        {user.identities.map((membership) => (
          <UserAffiliationRow
            key={membership.identityId}
            membership={membership}
            onChanged={onChanged}
            canManage={canManage}
            summarized={membership.identityId === summarizedIdentityId}
          />
        ))}

        {historyOpen &&
          formerIdentities.map((entry) => (
            <AffiliationRow
              key={entry.identityId}
              past
              media={<Avatar name={entry.organizationName ?? "Organization"} size="lg" />}
              title={entry.organizationName ?? "Individual member"}
              href={
                entry.organizationId ? usePortalHashLocation.hrefs(`/organizations/${entry.organizationId}`) : undefined
              }
              terms={[entry.jobTitle, `${entry.startedAt ? fmt(entry.startedAt) : "—"} – ${fmt(entry.endedAt)}`].filter(
                (term): term is string => Boolean(term),
              )}
            />
          ))}
      </PanelBody>

      {formerIdentities.length > 0 && (
        <ExpandFooter
          expanded={historyOpen}
          onToggle={() => {
            setHistoryOpen(!historyOpen);
          }}
          hiddenCount={formerIdentities.length}
          noun="organizations"
        />
      )}
    </Panel>
  );
}
