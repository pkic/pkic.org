import { personLegalName } from "../../../../../shared/person-display";
import { RepresentationEmailDialog } from "../../../../components/identities/RepresentationEmailDialog";
import { RepresentationCorrectionDialog } from "../../../../components/identities/RepresentationCorrectionDialog";
import { removeIncorrectRepresentation } from "./remove-representation";
import { useDialogQueryState } from "../../../../hooks/useDialogQueryState";
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
import { useState } from "preact/hooks";

import { formatTenure } from "../../../../shared/ui";
import { AffiliationRow } from "../../../../ui/AffiliationRow";
import { Avatar } from "../../../../ui/Avatar";
import { EmptyState } from "../../../../ui/EmptyState";
import { ExpandFooter } from "../../../../ui/ExpandFooter";
import { Button } from "../../../../ui/Button";
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
import { IdentityCreateDialog } from "../../../../components/identities/IdentityCreateDialog";
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
  const [correcting, setCorrecting] = useState<{
    identityId: string;
    organizationId: string | null;
    organizationName: string;
  } | null>(null);
  const [correctingOpen, showCorrecting, closeCorrecting] = useDialogQueryState("organization-correction");
  const [createdIdentityId, setCreatedIdentityId] = useState<string | null>(null);
  function correct(identityId: string, organizationId: string | null, organizationName: string) {
    setCorrecting({ identityId, organizationId, organizationName });
    setCreatedIdentityId(null);
    showCorrecting();
  }
  const [editingEmail, setEditingEmail] = useState<UserDetail["identities"][number] | null>(null);
  const [emailOpen, showEmail, closeEmail] = useDialogQueryState("representation-email");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [adding, showAdding, closeAdding] = useDialogQueryState("identity");
  const [busy, setBusy] = useState(false);
  const [reinstating, setReinstating] = useState<FormerIdentity | null>(null);
  // An emailed reinstatement link lands here, on the owner's own record.
  const [linkToken, setLinkToken] = useState(() =>
    viewerIsSubject ? portalHashParam(window.location.hash, "reinstatement") : null,
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
  // Staff correct and reinstate against proof of who the person is, so they read the legal name.
  const subjectName = personLegalName({ firstName: user.first_name, lastName: user.last_name }, user.email);

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
    if (entry.reinstatable && (viewerIsSubject || (canManage && canActivateIdentity)))
      items.push({
        id: "correct-organization",
        label: "Correct identity…",
        disabled: busy,
        onSelect: () => correct(entry.identityId, entry.organizationId, entry.organizationName ?? "Personal"),
      });
    if ((viewerIsSubject || (canManage && canActivateIdentity)) && entry.reinstatable)
      items.push({
        id: "remove-incorrect",
        label: "Delete identity…",
        danger: true,
        disabled: busy,
        onSelect: () =>
          void removeIncorrectRepresentation(entry.identityId, user.id, onChanged, setBusy, () =>
            correct(entry.identityId, entry.organizationId, entry.organizationName ?? "Personal"),
          ),
      });
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
        {(canManage || viewerIsSubject) && (
          <Button variant="ghost" icon aria-label="Add identity" title="Add identity" onClick={() => showAdding()}>
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
            canRemoveIdentity={canManage && canActivateIdentity}
            summarized={membership.identityId === summarizedIdentityId}
            viewerIsSubject={viewerIsSubject}
            subjectName={subjectName}
            seats={seatsOf(membership.identityId)}
            acting={membership.identityId === actingIdentityId}
            onEditEmail={
              membership.organizationId && (viewerIsSubject || canManage)
                ? () => {
                    setEditingEmail(membership);
                    showEmail();
                  }
                : undefined
            }
            onCorrect={
              viewerIsSubject || (canManage && canActivateIdentity)
                ? () =>
                    correct(membership.identityId, membership.organizationId, membership.organizationName ?? "Personal")
                : undefined
            }
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
              media={<Avatar name={entry.organizationName ?? "Personal"} shape="square" size="lg" />}
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

      {editingEmail && (
        <RepresentationEmailDialog
          key={editingEmail.identityId}
          userId={user.id}
          source={editingEmail}
          open={emailOpen}
          onClose={() => void closeEmail()}
          onChanged={onChanged}
        />
      )}
      {correcting && (
        <RepresentationCorrectionDialog
          key={correcting.identityId}
          open={correctingOpen}
          source={correcting}
          userId={user.id}
          isSelf={viewerIsSubject}
          preselectIdentityId={createdIdentityId ?? actingIdentityId}
          onAdd={showAdding}
          onClose={() => void closeCorrecting()}
          onCorrected={async (replacement) => {
            toast(`Identity corrected to ${replacement.organizationName ?? "Personal"}`, "success");
            await onChanged();
          }}
        />
      )}

      <IdentityCreateDialog
        open={adding}
        targetUserId={canManage && !viewerIsSubject ? user.id : undefined}
        canActivate={canActivateIdentity}
        preferImmediateActivation={correctingOpen}
        onBusy={setBusy}
        onClose={() => closeAdding()}
        onCreated={async (identityId) => {
          setCreatedIdentityId(identityId);
          await onChanged();
        }}
      />

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
