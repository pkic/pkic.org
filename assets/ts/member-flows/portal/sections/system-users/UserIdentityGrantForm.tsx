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
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  individualMembershipGrantSchema,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { organizationIdentityCreateRequestSchema } from "../../../../../shared/schemas/route-contracts-identities";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import type { UserDetail } from "./model";

const GRANT_MODE_ORG_TIED = "__org_tied__";

export function UserIdentityGrantForm({
  user,
  canActivate,
  onGranted,
  onCancel,
}: {
  user: UserDetail;
  canActivate: boolean;
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<string | null | undefined>(undefined);
  const [activationReason, setActivationReason] = useState("");
  const [activateImmediately, setActivateImmediately] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
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

  async function searchOrgs() {
    setSearching(true);
    try {
      const data = await getJson(
        `/api/v1/organizations?limit=10${orgQuery.trim() ? `&q=${encodeURIComponent(orgQuery.trim())}` : ""}`,
        organizationsListResponseSchema,
      );
      setOrgResults(data.organizations);
    } catch (searchError) {
      toast((searchError as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  async function pickOrg(orgId: string) {
    setSelectedOrgId(orgId);
    setSelectedOrgCategory(undefined);
    if (!orgId) return;
    try {
      const data = await getJson(`/api/v1/organizations/${orgId}`, organizationDetailResponseSchema);
      setSelectedOrgCategory(data.organization.membershipCategory);
    } catch (pickError) {
      toast((pickError as Error).message, "error");
    }
  }

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

  const organizationHelp =
    selectedOrgId && selectedOrgCategory !== undefined
      ? selectedOrgCategory
        ? `Category: ${selectedOrgCategory}`
        : "No category set on this organization yet."
      : undefined;

  return (
    <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={(event) => void handleSubmit(event)}>
      <div class="pk-grid pk-grid--tight">
        <Field label="Category" {...form.of("membershipCategory")}>
          {(control) => (
            <Select
              {...control}
              name="membershipCategory"
              value={mode}
              onChange={(event) => setMode((event.target as HTMLSelectElement).value)}
            >
              <option value={GRANT_MODE_ORG_TIED}>Organization-tied (set by org)</option>
              {mayGrantIndividual &&
                MEMBERSHIP_CATEGORIES.filter((category) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category)).map(
                  (category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ),
                )}
            </Select>
          )}
        </Field>

        {!isIndividual && (
          <>
            <div class="pk-stack pk-stack--tight">
              <Field label="Find organization">
                {(control) => (
                  <TextInput
                    {...control}
                    value={orgQuery}
                    onInput={(event) => setOrgQuery(event.currentTarget.value)}
                    // Enter searches rather than submitting the grant, which
                    // would otherwise fire before any organization is listed.
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void searchOrgs();
                    }}
                    placeholder="Organization name"
                  />
                )}
              </Field>
              <div class="pk-cluster">
                <Button size="sm" loading={searching} onClick={() => void searchOrgs()}>
                  Search
                </Button>
              </div>
            </div>

            <Field label="Organization" help={organizationHelp} {...form.of("organizationId")}>
              {(control) => (
                <Select
                  {...control}
                  name="organizationId"
                  value={selectedOrgId}
                  onChange={(event) => void pickOrg((event.target as HTMLSelectElement).value)}
                >
                  <option value="">— Pick —</option>
                  {orgResults.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
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
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
