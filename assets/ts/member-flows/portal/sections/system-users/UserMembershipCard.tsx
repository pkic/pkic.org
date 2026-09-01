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
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import type { UserMembership } from "./model";
import "../../../../ui/Content.css";

export function UserMembershipCard({
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

  return (
    <div class="pk">
      <Panel>
        <PanelBody class="pk-stack pk-stack--snug">
          <dl class="pk-datalist pk-small">
            <dt>Organization</dt>
            <dd>{membership.organizationName ?? <span class="pk-muted">Individual member</span>}</dd>
            {membership.organizationId && (
              <>
                <dt>Identity email</dt>
                <dd class="pk-break">{membership.email}</dd>
                <dt>Job title</dt>
                <dd>{membership.jobTitle || "—"}</dd>
              </>
            )}
            {membership.biography && (
              <>
                <dt>Biography</dt>
                <dd class="pk-answer-pre">{membership.biography}</dd>
              </>
            )}
            {membership.links.length > 0 && (
              <>
                <dt>Links</dt>
                <dd class="pk-stack pk-stack--tight pk-break">
                  {membership.links.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                  ))}
                </dd>
              </>
            )}
            {!categoryEditable && (
              <>
                <dt>Category</dt>
                <dd>
                  <ToneBadge tone="neutral">{membership.membershipCategory}</ToneBadge>
                </dd>
              </>
            )}
            {!statusEditable && (
              <>
                <dt>Status</dt>
                <dd>
                  <Badge status={membership.status} />
                </dd>
              </>
            )}
            <dt>Groups</dt>
            <dd>{membership.groups.length > 0 ? membership.groups.map((group) => group.name).join(", ") : "—"}</dd>
            <dt>Member since</dt>
            <dd class="pk-nowrap">{fmtDate(membership.createdAt)}</dd>
          </dl>

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

          {membership.organizationId && (
            <label class="pk-check">
              <input
                class="pk-check__input"
                type="checkbox"
                checked={membership.showOnOrgProfile}
                disabled={busy || !canManage}
                onChange={(event) =>
                  void patchIdentity(
                    { profile: { showOnOrganizationProfile: event.currentTarget.checked } },
                    "Identity visibility updated",
                  )
                }
              />
              <span class="pk-check__label">Show this person on {organizationLabel}&apos;s public profile</span>
            </label>
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

          {canManage && (
            <div class="pk-cluster">
              {membership.organizationId && (
                <Button size="sm" disabled={busy} onClick={toggleIdentityEditor}>
                  {editingProfile ? "Close identity editor" : "Edit identity profile"}
                </Button>
              )}
              <Button variant="danger-quiet" size="sm" disabled={busy} onClick={() => void endIdentity()}>
                End identity
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
