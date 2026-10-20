/**
 * Every identity a person holds or held — their experience — and the controls
 * that manage those ties. Laid out the way a résumé is: the position, where it
 * is held and for how long, and the group seats held as that identity under it.
 *
 * One panel, not two. The record previously stated each affiliation in an
 * Organizations panel and then restated the same rows as management cards in a
 * Membership panel below it — the same organization, job title, address, dates
 * and groups in both, with nothing keeping them consistent but the fact that
 * they read from the same object. A tie is one thing; it is stated once and
 * managed where it is stated.
 *
 * Ended ties are shown with the rest, dimmed, the way a résumé lists past
 * positions: they are the person's history in the consortium. The footer can
 * fold them away for a reader who only wants what is current.
 */
import { useRef, useState } from "preact/hooks";

import { formatTenure } from "../../../../shared/ui";
import { AffiliationRow } from "../../../../ui/AffiliationRow";
import { Avatar } from "../../../../ui/Avatar";
import { EmptyState } from "../../../../ui/EmptyState";
import { ExpandFooter } from "../../../../ui/ExpandFooter";
import { Button } from "../../../../ui/Button";
import { Dialog } from "../../../../ui/Dialog";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { ReinstateRepresentationDialog } from "../../../../components/identities/ReinstateRepresentationDialog";
import { toast } from "../../ui";
import { reinstateRepresentation } from "./reinstate-representation";
import { ReinstatementLinkDialog } from "./ReinstatementLinkDialog";
import { portalHashParam } from "../../hash-route";
import { IconPlus } from "../../../../components/icons";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { UserAffiliationRow } from "./UserAffiliationRow";
import { SelfIdentityCreateForm } from "./SelfIdentityCreateForm";
import { UserIdentityGrantForm } from "./UserIdentityGrantForm";
import type { UserDetail } from "./model";
import type { UserGroupParticipation } from "../../../../../shared/schemas/user-participation";
import { GroupSeatPositions } from "./GroupSeatPositions";
import { identityPublicProfilePath } from "./IdentityPublicProfileView";

type FormerIdentity = UserDetail["formerIdentities"][number];

export function UserAffiliationsPanel({
  user,
  onChanged,
  canManage,
  canActivateIdentity = false,
  summarizedIdentityId,
  viewerIsSubject = false,
  seats = [],
  actingIdentityId = null,
}: {
  /** The person's group seats, current and past; each is shown under the identity it was held as. */
  seats?: readonly UserGroupParticipation[];
  /** The identity the signed-in subject is acting as, marked on its entry; null for anybody else's record. */
  actingIdentityId?: string | null;
  user: UserDetail;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
  /** May activate an identity immediately when granting it. */
  canActivateIdentity?: boolean;
  /** The person reading the record is the person it is about. */
  viewerIsSubject?: boolean;
  /** The identity whose biography the record already states as its About. */
  summarizedIdentityId?: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reinstating, setReinstating] = useState<FormerIdentity | null>(null);
  // An emailed reinstatement link lands here, on the owner's own record.
  const [linkToken, setLinkToken] = useState(() =>
    viewerIsSubject ? portalHashParam(window.location.hash, "reinstatement") : null,
  );
  const addRoot = useRef<HTMLDivElement>(null);

  /*
   * An individual capacity is the end of the line: someone who is a member in
   * their own right holds no further identities, so the grant is withdrawn
   * rather than offered and refused.
   */
  const hasIndividualMembership = user.identities.some(
    (identity) => identity.organizationId === null && identity.memberId !== null,
  );
  // An account identity keeps sign-in and existing references valid; it is not
  // professional experience. Show it only when it is the person's sole identity
  // or carries membership, participation, or their current/default choice.
  const hasOrganizationIdentity = user.identities.some((identity) => identity.organizationId !== null);
  const profileIdentities = user.identities.filter(
    (identity) =>
      !hasOrganizationIdentity ||
      identity.organizationId !== null ||
      identity.memberId !== null ||
      identity.isDefault ||
      identity.identityId === actingIdentityId ||
      identity.groups.length > 0 ||
      seats.some((seat) => seat.identityId === identity.identityId),
  );
  const formerIdentities = user.formerIdentities;
  const seatsOf = (identityId: string) => seats.filter((seat) => seat.identityId === identityId);
  const subjectName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;

  function pastIdentityActions(entry: FormerIdentity): MenuItem[] {
    const items: MenuItem[] = [];
    if (canManage)
      items.push({
        id: "public-profile",
        label: "Public profile…",
        href: usePortalHashLocation.hrefs(identityPublicProfilePath(user.id, entry.identityId)),
      });
    // The person reinstates their own only through an address at the organization; staff need none.
    if (viewerIsSubject ? entry.selfReinstatable : canManage && entry.reinstatable)
      items.push({ id: "reinstate", label: "Reinstate representation…", onSelect: () => setReinstating(entry) });
    return items;
  }

  async function reinstate(entry: FormerIdentity): Promise<void> {
    const outcome = await reinstateRepresentation(entry, viewerIsSubject);
    if (outcome !== "reinstated") {
      toast(`Check ${outcome.linkSentTo} for the link`, "success");
      return;
    }
    toast("Representation reinstated", "success");
    await onChanged();
  }

  return (
    <Panel>
      {/*
        "Identity and experience": each entry is an identity the person acts
        as, and together they are the person's experience in the consortium —
        the term every professional network uses for this list.

        Adding an identity is the panel's one command, so it is a button in
        the header and opens its form in a dialog.
      */}
      <PanelHeader title="Identity and experience">
        {(canManage || viewerIsSubject) && !hasIndividualMembership && (
          <Button variant="ghost" icon aria-label="Add identity" title="Add identity" onClick={() => setAdding(true)}>
            <IconPlus />
          </Button>
        )}
      </PanelHeader>

      <PanelBody class="pk-stack">
        {user.identities.length === 0 && (
          <EmptyState
            title="No active identities."
            body="This user can sign in but acts in no membership capacity yet."
          />
        )}

        {profileIdentities.map((membership) => (
          <UserAffiliationRow
            key={membership.identityId}
            userId={user.id}
            membership={membership}
            onChanged={onChanged}
            canManage={canManage}
            summarized={membership.identityId === summarizedIdentityId}
            viewerIsSubject={viewerIsSubject}
            subjectName={[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}
            seats={seatsOf(membership.identityId)}
            acting={membership.identityId === actingIdentityId}
          />
        ))}

        {historyOpen &&
          formerIdentities.map((entry) => (
            <AffiliationRow
              key={entry.identityId}
              past
              actions={(() => {
                const items = pastIdentityActions(entry);
                return items.length > 0 ? (
                  <Menu
                    label={`Actions for ${entry.organizationName ?? "Individual member"}`}
                    align="end"
                    items={items}
                  />
                ) : undefined;
              })()}
              media={<Avatar name={entry.organizationName ?? "Organization"} shape="square" size="lg" />}
              title={entry.jobTitle ?? entry.organizationName ?? "Individual member"}
              subtitle={entry.jobTitle ? (entry.organizationName ?? "Individual member") : undefined}
              href={
                entry.organizationId && !entry.jobTitle
                  ? usePortalHashLocation.hrefs(`/organizations/${entry.organizationId}`)
                  : undefined
              }
              terms={[formatTenure(entry.startedAt, entry.endedAt)]}
              footer={
                seatsOf(entry.identityId).length > 0 ? (
                  <GroupSeatPositions seats={seatsOf(entry.identityId)} />
                ) : undefined
              }
            />
          ))}
      </PanelBody>

      {/* Creating an identity is a quick action, so it is a dialog: a person creates their own,
          and staff grant one to somebody else. The form is mounted only while open, so a
          cancelled draft does not linger. */}
      <Dialog
        open={adding}
        title="Add identity"
        closeLabel="Close add identity"
        confirmLabel={canManage ? "Grant" : "Create"}
        confirmDisabled={busy}
        onConfirm={() => addRoot.current?.querySelector("form")?.requestSubmit()}
        onCancel={() => {
          if (!busy) setAdding(false);
        }}
      >
        <div ref={addRoot}>
          {adding &&
            (canManage ? (
              <UserIdentityGrantForm
                user={user}
                canActivate={canActivateIdentity}
                onBusy={setBusy}
                onGranted={() => {
                  setAdding(false);
                  void onChanged();
                }}
              />
            ) : (
              <SelfIdentityCreateForm
                onBusy={setBusy}
                onCreated={() => {
                  setAdding(false);
                  void onChanged();
                }}
                onCancel={() => setAdding(false)}
              />
            ))}
        </div>
      </Dialog>

      {reinstating && (
        <ReinstateRepresentationDialog
          organizationName={reinstating.organizationName ?? "this organization"}
          subjectName={viewerIsSubject ? null : subjectName}
          emailAddress={reinstating.emailAddress}
          onReinstate={() => reinstate(reinstating)}
          onClose={() => setReinstating(null)}
        />
      )}

      {linkToken && (
        <ReinstatementLinkDialog
          token={linkToken}
          onReinstated={async () => {
            toast("Representation reinstated", "success");
            await onChanged();
          }}
          onClose={() => {
            history.replaceState(history.state, "", window.location.href.replace(/\?.*$/, ""));
            setLinkToken(null);
          }}
        />
      )}

      {formerIdentities.length > 0 && (
        <ExpandFooter
          expanded={historyOpen}
          onToggle={() => {
            setHistoryOpen(!historyOpen);
          }}
          hiddenCount={formerIdentities.length}
          noun="past identities"
        />
      )}
    </Panel>
  );
}
