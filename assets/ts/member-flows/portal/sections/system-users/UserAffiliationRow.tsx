import { removeIncorrectRepresentation } from "./remove-representation";
import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
/**
 * One tie between a person and an organization, stated and managed in place.
 *
 * The record used to say this twice: an Organizations panel that stated the
 * tie and a Membership panel that managed the same rows underneath it, so the
 * organization, job title, address and dates appeared in both and a reader had
 * to check the two agreed. There is one statement now, and the controls that
 * change it hang off it.
 *
 * Profile and visibility belong to the identity. Category and status come
 * from its member capacity, when one exists; an organization affiliation
 * alone does not establish membership.
 */
import { useRef, useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { memberCapacityMutationResponseSchema } from "../../../../../shared/schemas/membership-management";
import { MEMBER_STATUSES, memberStatusSchema } from "../../../../../shared/schemas/membership-categories";
import { deleteJson, patchJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { JOB_TITLE_NEEDED_LABEL, needsOrganizationJobTitle } from "../../../../../shared/schemas/identity-job-title";
import { myProfileSchema, myProfileUpdateSchema } from "../../../../../shared/schemas/me";
import { profile as profileSignal, saveProfile } from "../../state";
import { CURRENT_USER_API } from "./current-user-api";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { toast } from "../../ui";
import { formatTenure } from "../../../../shared/ui";
import { Badge, statusLabel } from "../../../../components/Badge";
import { AffiliationRow } from "../../../../ui/AffiliationRow";
import { Avatar } from "../../../../ui/Avatar";
import { Markdown } from "../../../../ui/Markdown";
import { Field } from "../../../../ui/Field";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { Select } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import type { UserMembership } from "./model";
import { PERSONAL_IDENTITY_LABEL } from "../../../../shared/acting-identity-catalog";
import { identityPublicProfilePath } from "./IdentityPublicProfileView";
import { identityProfileEditPath } from "./IdentityProfilePage";
import { Dialog } from "../../../../ui/Dialog";
import { IconCheckmark } from "../../../../ui/MediaIcons";
import type { UserGroupParticipation } from "../../../../../shared/schemas/user-participation";
import { GroupSeatPositions } from "./GroupSeatPositions";
import { EndRepresentationDialog } from "../../../../components/identities/EndRepresentationDialog";
import { endRepresentation } from "./end-representation";

/**
 * Says where an organization tie comes from when it follows an email domain:
 * the organization's name and logo live once on the organization, and
 * everyone on that domain is shown with it.
 */
export function organizationEmailDomainTerm(membership: UserMembership, viewerIsSubject: boolean): string | null {
  if (!membership.organizationId || !membership.organizationEmailDomain) return null;
  return `from ${viewerIsSubject ? "your" : "their"} @${membership.organizationEmailDomain} email`;
}

/** What an identity is called on its entry: its organization, an individual membership, or the person themself. */
export function identityEntryName(
  membership: Pick<UserMembership, "organizationName" | "organizationId" | "memberId">,
): string {
  return (
    membership.organizationName ??
    (membership.organizationId
      ? "Organization"
      : membership.memberId !== null
        ? "Individual member"
        : PERSONAL_IDENTITY_LABEL)
  );
}

export function UserAffiliationRow({
  userId,
  membership,
  onChanged,
  canManage,
  canRemoveIdentity = false,
  summarized = false,
  viewerIsSubject = false,
  subjectName,
  seats = [],
  acting = false,
  onCorrect,
  onEditEmail,
}: {
  /** The group seats held as this identity, current and past. */
  seats?: readonly UserGroupParticipation[];
  onCorrect?: () => void;
  onEditEmail?: () => void;
  /** The signed-in person is acting as this identity right now. */
  acting?: boolean;
  /** The person the record is about. */
  userId: string;
  /** Their name: a personal identity is the person themself, so it wears their initials. */
  subjectName?: string;
  membership: UserMembership;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
  canRemoveIdentity?: boolean;
  /** The person reading the record is the person it is about. */
  viewerIsSubject?: boolean;
  /**
   * This tie's description is already the record's About.
   *
   * There is one biography per identity. Repeating the About text on the
   * row that supplied it printed the same
   * paragraph twice. Every other affiliation still states its own.
   */
  summarized?: boolean;
}) {
  const categories = useMembershipCategoryLabels();
  const catalog = useMembershipCategoryCatalog();
  const [busy, setBusy] = useState(false);
  const [editingMembership, setEditingMembership] = useState(false);
  const [ending, setEnding] = useState(false);
  const membershipForm = useRef<HTMLFormElement>(null);
  // The membership editor is a draft: nothing is written until Save, so a
  // stray change to a select changes nothing (#91).
  const [draftCategory, setDraftCategory] = useState(membership.membershipCategory);
  const [draftStatus, setDraftStatus] = useState(membership.status);

  // An organization-tied identity takes its category and status from the
  // organization, so only an individual capacity is editable here.
  const hasMembership = membership.memberId !== null;
  const categoryEditable =
    hasMembership && membership.membershipCategory !== null && !membership.organizationId && canManage;
  const statusEditable = hasMembership && membership.status !== null && !membership.organizationId && canManage;
  const organizationName = identityEntryName(membership);
  // An organization or a membership is drawn by its own name; the personal
  // identity is the person, so it is drawn with their initials, not a "P".
  const avatarName = membership.organizationId || hasMembership ? organizationName : (subjectName ?? organizationName);
  // The editor's fields name the tie they belong to: the organization, or
  // for an individual capacity the membership itself.
  const organizationLabel =
    membership.organizationName ?? (membership.organizationId ? "this organization" : "this membership");

  async function patchMember(body: Record<string, unknown>): Promise<boolean> {
    if (!canManage || !hasMembership) return false;
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/members/capacities/${encodeURIComponent(membership.identityId)}`,
        body,
        memberCapacityMutationResponseSchema,
      );
      toast("Membership updated", "success");
      await onChanged();
      return true;
    } catch (error) {
      toast((error as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function patchIdentity(body: Record<string, unknown>, message: string) {
    if (!canManage || !membership.organizationId) return false;
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(membership.organizationId)}/identities/${encodeURIComponent(membership.identityId)}`,
        body,
        identityMutationResponseSchema,
      );
      toast(message, "success");
      await onChanged();
      return true;
    } catch (error) {
      toast((error as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** An individual membership ends now, after a confirmation; it has no organization tie to date. */
  async function endMembership() {
    if (!canManage || !hasMembership) return;
    const confirmed = await confirmAction({
      title: "End this individual membership?",
      body: "Their user account and other identities are kept.",
      consequences: ["This membership and its group participation end", "Their user account and sign-in remain"],
      confirmLabel: "End membership",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteJson(
        `/api/v1/members/capacities/${encodeURIComponent(membership.identityId)}`,
        successResponseSchema,
      );
      toast("Membership ended", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function openMembershipEditor() {
    if (!categoryEditable && !statusEditable) return;
    setDraftCategory(membership.membershipCategory);
    setDraftStatus(membership.status);
    setEditingMembership(true);
  }

  async function saveMembership() {
    if (!canManage || !hasMembership) return;
    const body: Record<string, unknown> = {};
    if (categoryEditable && draftCategory !== null && draftCategory !== membership.membershipCategory)
      body.membershipCategory = draftCategory;
    if (statusEditable && draftStatus !== null && draftStatus !== membership.status) body.status = draftStatus;
    // Nothing changed is not a refusal: the editor simply closes.
    if (Object.keys(body).length === 0) {
      setEditingMembership(false);
      return;
    }
    if (await patchMember(body)) setEditingMembership(false);
  }

  /*
   * The subject's own hold over whether this identity shows on its
   * organization's page. The member contract writes it for the identity the
   * session acts as, so only that row offers it.
   */
  const ownVisibilityEditable =
    viewerIsSubject &&
    !canManage &&
    Boolean(membership.organizationId) &&
    profileSignal.value?.identityId === membership.identityId;

  async function toggleOwnVisibility(): Promise<void> {
    setBusy(true);
    try {
      saveProfile(
        await patchJson(
          CURRENT_USER_API,
          myProfileUpdateSchema.parse({ showOnOrgProfile: !membership.showOnOrgProfile }),
          myProfileSchema,
        ),
      );
      toast("Identity visibility updated", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /*
   * The terms of the tie: how long it has been held and the address it runs
   * through. Empty entries are dropped rather than rendered as a dash — a
   * middot-separated line with a hole in it reads worse than a shorter one.
   *
   * The groups are not terms: they are positions held as this identity, and
   * sit under the entry as its timeline.
   */
  const organizationHref = membership.organizationId
    ? usePortalHashLocation.hrefs(`/organizations/${membership.organizationId}`)
    : undefined;
  const categoryLabel =
    hasMembership && membership.membershipCategory !== null ? categories.label(membership.membershipCategory) : null;

  const terms = [
    formatTenure(membership.createdAt, null),
    organizationEmailDomainTerm(membership, viewerIsSubject),
    membership.organizationId ? membership.email : null,
  ].filter((term): term is string => Boolean(term));

  /*
   * What can be done to this tie, as menu items.
   *
   * These were three controls on the row — two buttons and a checkbox — which
   * made a list of affiliations read as a list of things to click. A menu
   * states them only when someone goes looking, and the row goes back to
   * saying what the tie is.
   *
   * The visibility toggle keeps its state visible without the checkbox: the
   * marker beside the name says when the person is shown on the organization's
   * page, and the item names the change it will make rather than the state it
   * is in.
   */
  const rowActions: MenuItem[] = [];
  // Its owner edits any identity they hold through their own contract, even one
  // that is not an organization's; staff edit through the identity's own record.
  if (canManage || viewerIsSubject)
    rowActions.push({
      id: "profile",
      label: viewerIsSubject ? "Edit profile…" : "Edit identity profile…",
      disabled: busy,
      href: usePortalHashLocation.hrefs(identityProfileEditPath(userId, membership.identityId)),
    });
  if (ownVisibilityEditable) {
    rowActions.push({
      id: "visibility",
      label: membership.showOnOrgProfile
        ? `Hide from ${organizationLabel}'s public profile`
        : `Show on ${organizationLabel}'s public profile`,
      disabled: busy,
      onSelect: () => void toggleOwnVisibility(),
    });
  }
  if (membership.organizationId && canManage) {
    rowActions.push({
      id: "visibility",
      label: membership.showOnOrgProfile
        ? `Hide from ${organizationLabel}'s public profile`
        : `Show on ${organizationLabel}'s public profile`,
      disabled: busy,
      onSelect: () =>
        void patchIdentity(
          { profile: { showOnOrganizationProfile: !membership.showOnOrgProfile } },
          "Identity visibility updated",
        ),
    });
  }
  if (canManage)
    rowActions.push({
      id: "public-profile",
      label: "Public profile…",
      href: usePortalHashLocation.hrefs(identityPublicProfilePath(userId, membership.identityId)),
    });
  if (categoryEditable || statusEditable) {
    /*
     * The category and the standing are stated on the row already, as the two
     * badges beside the name. They used to be a pair of open selects in the
     * footer as well — a record arriving in edit mode (#47), and one that
     * wrote on every change, so a stray click on a `<select>` changed a
     * person's membership with nothing to confirm and nothing to undo.
     */
    rowActions.push({
      id: "membership",
      label: "Edit membership…",
      disabled: busy,
      onSelect: openMembershipEditor,
    });
  }
  if (membership.organizationId && onEditEmail)
    rowActions.push({ id: "change-email", label: "Change representation email…", onSelect: onEditEmail });
  if (onCorrect)
    rowActions.push({
      id: "correct-organization",
      label: "Correct identity…",
      disabled: busy,
      onSelect: onCorrect,
    });
  if (canManage || viewerIsSubject)
    rowActions.push({
      id: "remove-incorrect",
      label: "Delete identity…",
      danger: true,
      disabled: busy || !(viewerIsSubject || canRemoveIdentity),
      onSelect: () => void removeIncorrectRepresentation(membership.identityId, userId, onChanged, setBusy, onCorrect),
    });
  // The person ends their own representation; staff end someone else's.
  if (membership.organizationId && (viewerIsSubject || canManage))
    rowActions.push({
      id: "end",
      label: "End representation…",
      danger: true,
      separatorBefore: rowActions.length > 0,
      disabled: busy,
      onSelect: () => setEnding(true),
    });
  else if (hasMembership && canManage)
    rowActions.push({
      id: "end",
      label: "End membership…",
      danger: true,
      separatorBefore: rowActions.length > 0,
      disabled: busy,
      onSelect: () => void endMembership(),
    });

  return (
    <>
      <AffiliationRow
        media={
          <Avatar name={avatarName} shape={membership.organizationId || hasMembership ? "square" : "round"} size="lg" />
        }
        /*
         * An experience entry: the position held, then where it is held. A tie
         * with no job title is headed by the organization alone.
         */
        title={membership.jobTitle ?? organizationName}
        subtitle={
          membership.jobTitle || categoryLabel ? (
            <ul class="pk-affiliation__terms">
              {membership.jobTitle && (
                <li>{organizationHref ? <a href={organizationHref}>{organizationName}</a> : organizationName}</li>
              )}
              {categoryLabel && <li>{categoryLabel}</li>}
            </ul>
          ) : undefined
        }
        /*
         * Through to the organization's own record. Only an organization-tied
         * identity has one to lead to — an individual capacity is a member with
         * no organization behind it, so its name is a statement, not a link.
         */
        href={membership.jobTitle ? undefined : organizationHref}
        /*
         * What this tie is, said beside the name: the category the organization
         * is a member under, and its standing. This is the indicator that tells
         * a reader at a glance whether the organization on the row is a member
         * of the consortium or simply an employer.
         */
        marker={
          <span class="pk-cluster">
            {/* Active is the expected standing, so only an exception wears a badge. */}
            {hasMembership && membership.status !== null && membership.status !== "active" && (
              <Badge status={membership.status} />
            )}
            {membership.organizationId && membership.showOnOrgProfile && (
              <span class="pk-small pk-muted">Shown on the organization page</span>
            )}
            {needsOrganizationJobTitle(membership) && <ToneBadge tone="warn">{JOB_TITLE_NEEDED_LABEL}</ToneBadge>}
          </span>
        }
        terms={terms}
        footer={
          acting || seats.length > 0 ? (
            <>
              {acting && (
                <span class="pk-experience__acting">
                  <IconCheckmark aria-hidden="true" /> You're acting as this identity now
                </span>
              )}
              <GroupSeatPositions seats={seats} />
            </>
          ) : undefined
        }
        actions={
          rowActions.length > 0 ? (
            <Menu label={`Actions for ${organizationName}`} align="end" items={rowActions} />
          ) : undefined
        }
      >
        {summarized || !membership.biography ? undefined : <Markdown markdown={membership.biography} />}
      </AffiliationRow>
      <Dialog
        open={editingMembership && (categoryEditable || statusEditable)}
        title="Edit membership"
        closeLabel="Close membership editor"
        confirmLabel={busy ? "Saving…" : "Save"}
        confirmDisabled={busy}
        onConfirm={() => membershipForm.current?.requestSubmit()}
        onCancel={() => {
          if (!busy) setEditingMembership(false);
        }}
      >
        {editingMembership && (
          <form
            ref={membershipForm}
            noValidate
            class="pk-grid pk-grid--tight"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMembership();
            }}
          >
            {categoryEditable && (
              <Field label="Category">
                {(control) => (
                  <Select
                    {...control}
                    value={draftCategory ?? undefined}
                    disabled={busy}
                    onChange={(event) => setDraftCategory((event.target as HTMLSelectElement).value)}
                  >
                    {catalog
                      .filter((category) => category.isIndividual)
                      .map(({ code: category }) => (
                        <option key={category} value={category}>
                          {categories.label(category)}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}
            {statusEditable && (
              <Field label="Status">
                {(control) => (
                  <Select
                    {...control}
                    value={draftStatus ?? undefined}
                    disabled={busy || !canManage}
                    onChange={(event) => setDraftStatus(memberStatusSchema.parse(event.currentTarget.value))}
                  >
                    {MEMBER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </form>
        )}
      </Dialog>
      {ending && (
        <EndRepresentationDialog
          organizationName={organizationName}
          subjectName={viewerIsSubject ? null : (subjectName ?? "this person")}
          startedAt={membership.createdAt}
          onEnd={async (endedAt) => {
            await endRepresentation(membership, viewerIsSubject, endedAt);
            toast("Representation ended", "success");
            await onChanged();
          }}
          onClose={() => setEnding(false)}
        />
      )}
    </>
  );
}
