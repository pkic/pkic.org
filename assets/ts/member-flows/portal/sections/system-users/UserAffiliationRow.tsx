/**
 * One tie between a person and an organization, stated and managed in place.
 *
 * The record used to say this twice: an Organizations panel that stated the
 * tie and a Membership panel that managed the same rows underneath it, so the
 * organization, job title, address and dates appeared in both and a reader had
 * to check the two agreed. There is one statement now, and the controls that
 * change it hang off it.
 *
 * The tie's own facts — category, status, whether it shows on the
 * organization's page — belong to the identity, not to the account, which is
 * why they read from `membership` rather than from the user.
 */
import { useId, useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import { MEMBER_STATUSES } from "../../../../../shared/schemas/membership-categories";
import { deleteJson, patchJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { fmtDate, toast } from "../../ui";
import { Badge, statusLabel } from "../../../../components/Badge";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { AffiliationRow } from "../../../../ui/AffiliationRow";
import { Avatar } from "../../../../ui/Avatar";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import type { UserMembership } from "./model";

export function UserAffiliationRow({
  membership,
  onChanged,
  canManage,
}: {
  membership: UserMembership;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [jobTitle, setJobTitle] = useState(membership.jobTitle ?? "");
  const [biography, setBiography] = useState(membership.biography ?? "");
  const [links, setLinks] = useState(membership.links);
  const linksLabelId = `${useId()}-identity-links`;

  // An organization-tied identity takes its category and status from the
  // organization, so only an individual capacity is editable here.
  const categoryEditable = !membership.organizationId && canManage;
  const statusEditable = !membership.organizationId;
  const organizationName = membership.organizationName ?? "Individual member";
  const organizationLabel = membership.organizationName ?? "this organization";

  async function patchMember(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/members/capacities/${encodeURIComponent(membership.memberId)}`,
        body,
        memberCapacityMutationResponseSchema,
      );
      toast("Membership updated", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function patchIdentity(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(membership.organizationId ?? "")}/identities/${encodeURIComponent(membership.identityId)}`,
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

  async function endIdentity() {
    const target = membership.organizationName ?? "this individual identity";
    const confirmed = await confirmAction({
      title: `End the identity for ${target}?`,
      body: "Their user account and other identities are kept.",
      consequences: ["This acting identity and its group participation end", "Their user account and sign-in remain"],
      confirmLabel: "End identity",
    });
    if (!confirmed) return;
    if (membership.organizationId) {
      await patchIdentity({ transition: { state: "ended", reason: "Ended from System Users" } }, "Identity ended");
      return;
    }
    setBusy(true);
    try {
      await deleteJson(`/api/v1/members/capacities/${encodeURIComponent(membership.memberId)}`, successResponseSchema);
      toast("Identity ended", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveIdentityProfile() {
    if (!membership.organizationId) return;
    const saved = await patchIdentity(
      { profile: { jobTitle: jobTitle.trim() || null, biography: biography.trim() || null, links } },
      "Identity profile updated",
    );
    if (saved) setEditingProfile(false);
  }

  function toggleIdentityEditor() {
    if (!editingProfile) {
      setJobTitle(membership.jobTitle ?? "");
      setBiography(membership.biography ?? "");
      setLinks(membership.links);
    }
    setEditingProfile((current) => !current);
  }

  /*
   * The terms of the tie: the role held there, when it started, and the
   * address it runs through. Empty entries are dropped rather than rendered as
   * a dash — a middot-separated line with a hole in it reads worse than a
   * shorter one.
   *
   * Not the groups. They were listed here and are already stated twice over on
   * this record — once per group in the participation table, with the seat and
   * the attendance beside them. Which groups an *organization* is in is a fact
   * about the organization, and belongs on its own record.
   */
  const terms = [
    membership.jobTitle,
    `since ${fmtDate(membership.createdAt)}`,
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
  if (membership.organizationId) {
    rowActions.push({
      id: "profile",
      label: editingProfile ? "Close identity editor" : "Edit identity profile…",
      disabled: busy,
      onSelect: toggleIdentityEditor,
    });
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
  rowActions.push({
    id: "end",
    label: "End identity…",
    danger: true,
    separatorBefore: rowActions.length > 0,
    disabled: busy,
    onSelect: () => void endIdentity(),
  });

  return (
    <AffiliationRow
      media={<Avatar name={organizationName} size="lg" />}
      title={organizationName}
      /*
       * Through to the organization's own record. Only an organization-tied
       * identity has one to lead to — an individual capacity is a member with
       * no organization behind it, so its name is a statement, not a link.
       */
      href={
        membership.organizationId
          ? usePortalHashLocation.hrefs(`/organizations/${membership.organizationId}`)
          : undefined
      }
      /*
       * What this tie is, said beside the name: the category the organization
       * is a member under, and its standing. This is the indicator that tells
       * a reader at a glance whether the organization on the row is a member
       * of the consortium or simply an employer.
       */
      marker={
        <span class="pk-cluster">
          <ToneBadge tone="neutral">{membership.membershipCategory}</ToneBadge>
          <Badge status={membership.status} />
          {membership.organizationId && membership.showOnOrgProfile && (
            <span class="pk-small pk-muted">Shown on the organization page</span>
          )}
        </span>
      }
      terms={terms}
      actions={
        canManage ? <Menu label={`Actions for ${organizationName}`} align="end" items={rowActions} /> : undefined
      }
      footer={
        <>
          {(categoryEditable || statusEditable) && (
            <div class="pk-grid pk-grid--tight">
              {categoryEditable && (
                <Field label="Category">
                  {(control) => (
                    <Select
                      {...control}
                      value={membership.membershipCategory}
                      disabled={busy}
                      onChange={(event) =>
                        void patchMember({ membershipCategory: (event.target as HTMLSelectElement).value })
                      }
                    >
                      {MEMBERSHIP_CATEGORIES.filter((category) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category)).map(
                        (category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ),
                      )}
                    </Select>
                  )}
                </Field>
              )}
              {statusEditable && (
                <Field label="Status">
                  {(control) => (
                    <Select
                      {...control}
                      value={membership.status}
                      disabled={busy || !canManage}
                      onChange={(event) => void patchMember({ status: (event.target as HTMLSelectElement).value })}
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
            </div>
          )}

          {editingProfile && membership.organizationId && (
            <div class="pk-stack pk-stack--snug">
              <div class="pk-grid pk-grid--tight">
                <Field label={`Job title for ${organizationLabel}`}>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={jobTitle}
                      onInput={(event) => setJobTitle(event.currentTarget.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
                <div class="pk-stack pk-stack--tight">
                  <span class="pk-strong pk-small" id={linksLabelId}>
                    Profile links for {organizationLabel}
                  </span>
                  <div role="group" aria-labelledby={linksLabelId}>
                    <ProfileLinksInput
                      fieldName={`identity.${membership.identityId}.links`}
                      value={links}
                      onChange={setLinks}
                    />
                  </div>
                </div>
              </div>
              <Field label={`Biography for ${organizationLabel}`}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={biography}
                    onInput={(event) => setBiography(event.currentTarget.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <div class="pk-cluster">
                <Button variant="primary" size="sm" loading={busy} onClick={() => void saveIdentityProfile()}>
                  {busy ? "Saving…" : "Save identity profile"}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingProfile(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      }
    >
      {membership.biography ?? undefined}
    </AffiliationRow>
  );
}
