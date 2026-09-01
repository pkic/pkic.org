import { useState } from "preact/hooks";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { getJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import type { UserDetail } from "./model";
import { UserMembershipCard } from "./UserMembershipCard";

const GRANT_MODE_ORG_TIED = "__org_tied__";

/**
 * Which control a validation message belongs to. A message tied to a field is
 * rendered by that field, so the control carries `aria-invalid` and points at
 * the text through `aria-describedby`; `null` is a whole-form failure — an API
 * error — and reaches the reader as an Alert instead.
 */
type GrantErrorField = "organization" | "reason" | null;

interface GrantError {
  field: GrantErrorField;
  message: string;
}

function GrantMembershipForm({
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
  const [error, setError] = useState<GrantError | null>(null);

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const mayGrantIndividual = canActivate && user.identities.length === 0;
  const needsReason = isIndividual || activateImmediately;

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
    if (!isIndividual && !selectedOrgId) {
      setError({ field: "organization", message: "Pick an organization." });
      return;
    }
    if (!isIndividual && !selectedOrgCategory) {
      setError({
        field: "organization",
        message: "This organization has no membership category set yet — set it in Organizations first.",
      });
      return;
    }
    if (needsReason && !activationReason.trim()) {
      setError({ field: "reason", message: "Document why this identity is being activated immediately." });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isIndividual) {
        await postJson(
          "/api/v1/members/capacities",
          { userId: user.id, membershipCategory: mode, activationReason: activationReason.trim() },
          memberCapacityMutationResponseSchema,
        );
      } else {
        await postJson(
          `/api/v1/organizations/${selectedOrgId}/identities`,
          {
            userReference: "existing_user",
            userId: user.id,
            showOnOrganizationProfile: true,
            activation: activateImmediately
              ? { mode: "immediate", reason: activationReason.trim() }
              : { mode: "invitation" },
          },
          identityMutationResponseSchema,
        );
      }
      toast("Membership granted", "success");
      onGranted();
    } catch (submitError) {
      const message = (submitError as Error).message;
      setError({ field: null, message });
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
    <form class="pk-stack pk-stack--snug" onSubmit={(event) => void handleSubmit(event)}>
      <div class="pk-grid pk-grid--tight">
        <Field label="Category">
          {(control) => (
            <Select {...control} value={mode} onChange={(event) => setMode((event.target as HTMLSelectElement).value)}>
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

            <Field
              label="Organization"
              help={organizationHelp}
              state={error?.field === "organization" ? "invalid" : undefined}
              message={error?.field === "organization" ? error.message : undefined}
            >
              {(control) => (
                <Select
                  {...control}
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
          <label class="pk-check">
            <input
              id="identity-activate-immediately"
              class="pk-check__input"
              type="checkbox"
              checked={activateImmediately}
              onChange={(event) => setActivateImmediately(event.currentTarget.checked)}
            />
            <span class="pk-check__label">
              Activate immediately
              <span class="pk-check__hint">
                Requires identities:activate. Otherwise the user must accept the invitation.
              </span>
            </span>
          </label>
        )}

        {needsReason && (
          <Field
            label="Activation reason"
            required
            state={error?.field === "reason" ? "invalid" : undefined}
            message={error?.field === "reason" ? error.message : undefined}
          >
            {(control) => (
              <TextInput
                {...control}
                value={activationReason}
                onInput={(event) => setActivationReason(event.currentTarget.value)}
              />
            )}
          </Field>
        )}
      </div>

      {error?.field === null && <Alert tone="danger">{error.message}</Alert>}

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

export function UserMembershipPanel({
  user,
  onChanged,
  canManage,
  canActivate,
}: {
  user: UserDetail;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
  canActivate: boolean;
}) {
  const [showGrantForm, setShowGrantForm] = useState(false);
  const hasIndividualMembership = user.identities.some((identity) => identity.organizationId === null);

  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Membership" />
        <PanelBody class="pk-stack pk-stack--snug">
          {user.identities.length === 0 && !showGrantForm && (
            <EmptyState
              title="No active identities."
              body="This user can sign in but acts in no membership capacity yet."
            />
          )}
          {user.identities.length > 0 && (
            <div class="pk-stack pk-stack--snug">
              {user.identities.map((membership) => (
                <UserMembershipCard
                  key={membership.identityId}
                  membership={membership}
                  onChanged={onChanged}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
          {canManage && showGrantForm ? (
            <GrantMembershipForm
              user={user}
              canActivate={canActivate}
              onGranted={() => {
                setShowGrantForm(false);
                void onChanged();
              }}
              onCancel={() => setShowGrantForm(false)}
            />
          ) : canManage && !hasIndividualMembership ? (
            <div class="pk-cluster">
              <Button size="sm" onClick={() => setShowGrantForm(true)}>
                Add identity
              </Button>
            </div>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}
