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
import { useEffect, useState } from "preact/hooks";
import {
  individualMembershipGrantSchema,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import type { OrganizationSummary } from "../../../../../shared/schemas/organization-management";
import { adminOrganizationCatalog } from "../../../../shared/management-catalogs";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { organizationIdentityCreateRequestSchema } from "../../../../../shared/schemas/route-contracts-identities";
import { useContractForm } from "../../../../hooks/useContractForm";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../../../shared/email-first-copy";
import { postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { Alert } from "../../../../ui/Alert";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import type { UserDetail } from "./model";

const GRANT_MODE_ORG_TIED = "__org_tied__";

/**
 * Staff adding an identity to a person: the form is the body of the dialog the
 * Affiliations panel's Add identity button opens; the dialog owns Grant and Cancel.
 */
export function UserIdentityGrantForm({
  user,
  canActivate,
  onGranted,
  onBusy,
  preferImmediateActivation = false,
}: {
  user: UserDetail;
  canActivate: boolean;
  onGranted: (identityId?: string) => void;
  preferImmediateActivation?: boolean;
  /** Reports a save in flight so the dialog's confirm cannot double-submit. */
  onBusy?: (busy: boolean) => void;
}) {
  const categories = useMembershipCategoryLabels();
  const catalog = useMembershipCategoryCatalog();
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationSummary | null>(null);
  const [activationReason, setActivationReason] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [activateImmediately, setActivateImmediately] = useState(canActivate && preferImmediateActivation);
  const [saving, setSaving] = useState(false);
  useEffect(() => onBusy?.(saving), [saving]);
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
    jobTitle,
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
      let grantedIdentityId: string | undefined;
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
        const created = await postJson(
          `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
          identity,
          identityMutationResponseSchema,
        );
        grantedIdentityId = created.identityId;
      }
      toast("Membership granted", "success");
      onGranted(grantedIdentityId);
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
    <section aria-label="Add identity">
      <div>
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
                    catalog={adminOrganizationCatalog}
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

            {!isIndividual && (
              <Field
                label={ORGANIZATION_JOB_TITLE_COPY.label}
                help="Their role at this organization, shown with their name."
                required
                {...form.of("jobTitle")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="jobTitle"
                    value={jobTitle}
                    onInput={(event) => setJobTitle(event.currentTarget.value)}
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
        </form>
      </div>
    </section>
  );
}
