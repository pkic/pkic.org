/**
 * One organization's record, read like an account page in a CRM.
 *
 * The page opens with one statement of what it is — `PageHeader` carries the
 * trail, the name, and the qualifying badges — and then shows the account:
 * its profile, the people who represent it, and its sponsorships, with the
 * mark and the contacts beside them. Nothing is behind a tab: a reader who
 * opens an organization wants to see who is there, and a facet that costs
 * one bounded query each does not need a click to earn it. The version this
 * replaces split the same three lists into tabs and made "who represents
 * this organization" a second step.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import {
  organizationDetailResponseSchema,
  organizationManagementUpdateSchema,
  type OrganizationDetail as OrganizationDetailModel,
} from "../../../../../shared/schemas/organization-management";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert, friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmtDate, toast } from "../../ui";
import { draftFromOrganization, payloadFromDraft, type OrganizationDraft } from "./OrganizationDraft";
import {
  OrganizationAbout,
  OrganizationContacts,
  OrganizationLinks,
  OrganizationMembershipCard,
} from "./OrganizationProfile";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationActivity } from "./OrganizationActivity";
import { OrganizationSponsorshipStanding } from "./OrganizationSponsorshipStanding";
import { IdentityRoster } from "./IdentityRoster";
// `pk-mono` on the category code comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so this module pulls it in itself.
import "../../../../ui/Content.css";

export function OrganizationDetail({
  organizationId,
  canRead,
  canWrite,
  canManageIdentities,
  canReadSponsorships,
}: {
  organizationId: string;
  canRead: boolean;
  canWrite: boolean;
  canManageIdentities: boolean;
  canReadSponsorships: boolean;
}) {
  const [organization, setOrganization] = useState<OrganizationDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Editing is the page's mode, not a card's: one draft, one Save, and every
  // card keeps its layout while its values become inputs.
  const [draft, setDraft] = useState<OrganizationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // One basis for validation: the shared update contract the server parses
  // decides what each field shows, live, and what Save may send.
  const form = useContractForm(
    organizationManagementUpdateSchema,
    draft && organization ? payloadFromDraft(draft, organization.updatedAt) : {},
  );

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}`,
        organizationDetailResponseSchema,
      );
      setOrganization(response.organization);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canRead, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return <ErrorAlert error="Organization details require the organizations:read permission." />;
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!organization) return null;

  const count = organization.activeIdentityCount;
  const editing = draft !== null;
  const hasLinks =
    organization.links.length > 0 ||
    Boolean(organization.website ?? organization.blogUrl ?? organization.pressUrl ?? organization.careersUrl);
  const onDraft = (next: Partial<OrganizationDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));
  const stopEditing = () => {
    setDraft(null);
    form.reset();
    setSaveError("");
  };

  async function save() {
    if (!draft || !organization) return;
    // Nothing leaves the page until the contract accepts the whole draft.
    const checked = form.submit();
    if (!checked.data) {
      setSaveError(checked.message);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        checked.data,
        organizationDetailResponseSchema,
      );
      toast("Organization updated", "success");
      stopEditing();
      await load();
    } catch (caught) {
      // A server refusal names its fields the same way the contract does.
      const message = form.refuse(caught);
      setSaveError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  const cardProps = {
    organization,
    draft: draft ?? undefined,
    onDraft: editing ? onDraft : undefined,
    busy: saving,
    fields: form.of,
  };
  // Every field on the page reports through the one contract while editing.
  const liveHandlers = editing ? form.handlers : {};

  return (
    <section class="pk pk-stack" aria-label={organization.name}>
      {/*
        The same two controls the contact record opens with: a trail, which is
        navigation, and then the subject itself. `PageHeader` names a place in
        the portal; an organization record is about an organization, so it gets
        the subject header — the mark leads, and what identifies the account
        sits under the name rather than as badges beside a page title.
      */}
      <Breadcrumb
        items={[
          { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
          { label: organization.name },
        ]}
      />
      <ProfileHeader
        media={<OrganizationLogo size="mark" organization={organization} canWrite={canWrite} onChanged={load} />}
        // While editing, the title follows the Name field as it is typed.
        title={draft?.name.trim() ? draft.name : organization.name}
        lede={draft?.slogan.trim() ? draft.slogan : (organization.slogan ?? undefined)}
        facts={[
          organization.membershipCategory ? (
            <>
              Category <span class="pk-mono">{organization.membershipCategory}</span>
            </>
          ) : null,
          organization.memberSince ? `Member since ${fmtDate(organization.memberSince)}` : null,
          /* Reads as a sentence rather than as a bare number. */
          `${String(count)} active ${count === 1 ? "representative" : "representatives"}`,
        ].filter((fact) => fact !== null)}
        actions={
          canWrite ? (
            editing ? (
              /* Save and Cancel stay buttons: they are a form's own controls,
                 and burying "Save" in a menu would hide the only way out of
                 edit mode behind a click. */
              <>
                <Button
                  variant="primary"
                  size="sm"
                  loading={saving}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save
                </Button>
                <Button size="sm" disabled={saving} onClick={stopEditing}>
                  Cancel
                </Button>
              </>
            ) : (
              <Menu
                label="Record actions"
                align="end"
                items={[
                  {
                    id: "edit",
                    label: "Edit organization…",
                    onSelect: () => setDraft(draftFromOrganization(organization)),
                  },
                ]}
              />
            )
          ) : undefined
        }
      />
      {saveError && <Alert tone="danger">{friendlyErrorMessage(saveError)}</Alert>}

      {/* The account: what the organization says about itself and who
          represents it take the width; its mark and its standing — as a
          member, as a sponsor — and its contacts keep the column beside them.
          The side column's lists share one term measure, so their values sit
          on one edge. In edit mode the same cards carry inputs in place. */}
      <div class="pk-record" {...liveHandlers}>
        <div class="pk-stack">
          <OrganizationAbout {...cardProps} />
          <IdentityRoster organization={organization} canManageIdentities={canManageIdentities} onChanged={load} />
          {/* What the account has done across the consortium, one bounded
              query per tab, aggregated over its representatives. */}
          <OrganizationActivity organizationId={organization.id} canReadSponsorships={canReadSponsorships} />
        </div>
        <div class="pk-stack pk-datalist-aligned">
          <OrganizationMembershipCard {...cardProps} />
          {canReadSponsorships && (
            <OrganizationSponsorshipStanding organizationId={organization.id} canWrite={canWrite} />
          )}
          <OrganizationContacts {...cardProps} />
          {/* The mark moved into the header, where the subject is; what is
              left here is where to find the organization.

              Absent rather than empty when the organization has stated no
              links and nobody is editing: a titled panel with nothing in it
              claims a fact the record does not have. */}
          {(editing || hasLinks) && (
            /* Named, so the panel is a region a reader can jump to — a bare
               `<section>` carries no role at all without one. */
            <Panel aria-label="Links">
              <PanelHeader title="Links" />
              <PanelBody>
                <OrganizationLinks {...cardProps} />
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}
