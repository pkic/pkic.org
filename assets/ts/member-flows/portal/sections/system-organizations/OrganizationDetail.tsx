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
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";
import { draftFromOrganization, payloadFromDraft, type OrganizationDraft } from "./OrganizationDraft";
import {
  OrganizationAbout,
  OrganizationContacts,
  OrganizationLinks,
  OrganizationMembershipCard,
} from "./OrganizationProfile";
import { Badge } from "../../../../ui/Badge";
import { PageHeader } from "../../../../ui/PageHeader";
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
      <PageHeader
        trail={[
          { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
          { label: organization.name },
        ]}
        // While editing, the title follows the Name field as it is typed.
        title={draft?.name.trim() ? draft.name : organization.name}
        context={
          <>
            {organization.membershipCategory && (
              <Badge tone="neutral" dot={false}>
                Category <span class="pk-mono">{organization.membershipCategory}</span>
              </Badge>
            )}
            {/* Reads as a sentence rather than as a bare number. */}
            <Badge tone={count > 0 ? "ok" : "warn"}>
              {count} active {count === 1 ? "representative" : "representatives"}
            </Badge>
          </>
        }
        actions={
          canWrite ? (
            editing ? (
              <>
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save
                </Button>
                <Button disabled={saving} onClick={stopEditing}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => setDraft(draftFromOrganization(organization))}>Edit</Button>
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
          {/* The identity card: the mark with the organization's links under
              it — one card, so the mark is not a lone box above the rest. */}
          <Panel aria-label="Identity">
            <PanelBody class="pk-stack pk-stack--snug">
              <OrganizationLogo organization={organization} canWrite={canWrite} onChanged={load} />
              <OrganizationLinks {...cardProps} />
            </PanelBody>
          </Panel>
          <OrganizationMembershipCard {...cardProps} />
          {canReadSponsorships && (
            <OrganizationSponsorshipStanding organizationId={organization.id} canWrite={canWrite} />
          )}
          <OrganizationContacts {...cardProps} />
        </div>
      </div>
    </section>
  );
}
