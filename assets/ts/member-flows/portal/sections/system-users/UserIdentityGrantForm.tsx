import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
/**
 * Granting a person a new acting capacity.
 *
 * Two routes, two contracts: an individual capacity is granted on the member
 * capacities collection, an organization-tied one is an identity created on
 * the organization. The category picker decides which is in play, and each
 * draft is checked by the contract the route it goes to actually parses.
 *
 * Its own module because it is a form, not a statement: the panel it opens
 * from states ties, and keeping the two apart is what stops that panel being
 * both a record and a form in one file.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  individualMembershipGrantSchema,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import {
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { organizationIdentityCreateRequestSchema } from "../../../../../shared/schemas/route-contracts-identities";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { Alert } from "../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import type { UserDetail } from "./model";

const GRANT_MODE_ORG_TIED = "__org_tied__";

/**
 * The organizations a person can be tied to, searched and paged on the
 * server. The list summary already carries the membership category, so
 * picking one needs no second request for the record (#96).
 */
const organizationCatalog: ServerCatalog<OrganizationSummary, z.infer<typeof organizationsListResponseSchema>> = {
  endpoint: "/api/v1/organizations",
  responseSchema: organizationsListResponseSchema,
  resolveItems: (response) => response.organizations,
  resolvePage: (response) => response.page,
  itemKey: (organization) => organization.id,
  itemLabel: (organization) => organization.name,
  sort: "name",
};

/**
 * Adding an identity to a person: a page of its own under the record, never a
 * form unfolding inside the Affiliations panel (#107). The way back is the
 * record's own address.
 */
export function UserIdentityGrantForm({
  user,
  canActivate,
  onGranted,
  cancelHref,
}: {
  user: UserDetail;
  canActivate: boolean;
  onGranted: () => void;
  /** The record this page sits under. */
  cancelHref: string;
}) {
  const categories = useMembershipCategoryLabels();
  const catalog = useMembershipCategoryCatalog();
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationSummary | null>(null);
  const [activationReason, setActivationReason] = useState("");
  const [activateImmediately, setActivateImmediately] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedOrgId = selectedOrg?.id ?? "";
  // A whole-form failure — an API refusal that names no field — reaches the
  // reader as an Alert; a refusal that names a field is shown on that field.
  const [error, setError] = useState("");

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const mayGrantIndividual = canActivate && user.identities.length === 0;
  const needsReason = isIndividual || activateImmediately;

  // Two routes, two contracts: an individual capacity is granted on the
  // member capacities collection, an organization-tied one is an identity
  // created on the organization. Each is checked by the contract its route
  // parses, and the category picker decides which one is in play.
  const individualGrant = useContractForm(individualMembershipGrantSchema, {
    userId: user.id,
    membershipCategory: mode,
    activationReason,
  });
  const identityInvitation = useContractForm(organizationIdentityCreateRequestSchema, {
    organizationId: selectedOrgId,
    userReference: "existing_user",
    userId: user.id,
    showOnOrganizationProfile: true,
    activation: activateImmediately ? { mode: "immediate", reason: activationReason } : { mode: "invitation" },
  });
  const form = isIndividual ? individualGrant : identityInvitation;
  // The reason is `activationReason` on a grant and `activation.reason` on an
  // invitation; the contract reports the latter under its top-level key.
  const reasonField = isIndividual ? "activationReason" : "activation";

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setError("");
    try {
      // Nothing leaves the page until the contract accepts the whole draft.
      if (isIndividual) {
        const checked = individualGrant.submit();
        if (!checked.data) {
          setError(checked.message);
          return;
        }
        setSaving(true);
        await postJson("/api/v1/members/capacities", checked.data, memberCapacityMutationResponseSchema);
      } else {
        const checked = identityInvitation.submit();
        if (!checked.data) {
          setError(checked.message);
          return;
        }
        setSaving(true);
        const { organizationId, ...identity } = checked.data;
        await postJson(
          `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
          identity,
          identityMutationResponseSchema,
        );
      }
      toast("Membership granted", "success");
      onGranted();
    } catch (submitError) {
      // A server refusal names its fields the same way the contract does.
      const message = form.refuse(submitError);
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  // The category comes with the organization: it is stated under the picker
  // rather than asked for in a select that then says it is set elsewhere.
  const organizationHelp = selectedOrg
    ? selectedOrg.membershipCategory
      ? categories.label(selectedOrg.membershipCategory)
      : "This organization is not a consortium member."
    : "Search by name; the membership category follows the organization.";

  return (
    <Panel aria-label="Add identity">
      <PanelHeader title="Add identity" breadcrumb />
      <PanelBody>
        <form
          noValidate
          class="pk-stack pk-stack--snug"
          {...form.handlers}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div class="pk-grid pk-grid--tight">
            {/* Only a person with no capacity at all can be given an individual
            one; everyone else is tied to an organization, and the category
            select — which then only said "set by the organization" — has
            nothing to ask (#96). */}
            {mayGrantIndividual && (
              <Field label="Category" {...form.of("membershipCategory")}>
                {(control) => (
                  <Select
                    {...control}
                    name="membershipCategory"
                    value={mode}
                    onChange={(event) => setMode((event.target as HTMLSelectElement).value)}
                  >
                    <option value={GRANT_MODE_ORG_TIED}>Organization-tied (set by org)</option>
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

            {!isIndividual && (
              <Field label="Organization" help={organizationHelp} {...form.of("organizationId")}>
                {(control) => (
                  <ServerSearchSelect
                    {...control}
                    catalog={organizationCatalog}
                    searchLabel="Organization"
                    value={selectedOrgId || null}
                    selectedLabel={selectedOrg?.name}
                    placeholder="Search organizations…"
                    allowEmpty
                    onChange={setSelectedOrg}
                  />
                )}
              </Field>
            )}

            {!isIndividual && canActivate && (
              <Checkbox
                id="identity-activate-immediately"
                checked={activateImmediately}
                onChange={(event) => setActivateImmediately(event.currentTarget.checked)}
                label="Activate immediately"
                hint="Requires identities:activate. Otherwise the user must accept the invitation."
              />
            )}

            {needsReason && (
              <Field label="Activation reason" required {...form.of(reasonField)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={reasonField}
                    value={activationReason}
                    onInput={(event) => setActivationReason(event.currentTarget.value)}
                  />
                )}
              </Field>
            )}
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <div class="pk-cluster">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Grant
            </Button>
            <ButtonLink variant="ghost" size="sm" href={usePortalHashLocation.hrefs(cancelHref)}>
              Cancel
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
