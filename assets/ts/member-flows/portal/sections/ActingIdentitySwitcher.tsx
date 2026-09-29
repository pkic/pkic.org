/**
 * Which identity the portal is acting as.
 *
 * This is not a fact about a person, so it does not belong on a person's
 * record: it is a setting on this session, deciding which membership the
 * working groups, votes and applications around it are scoped to. It sits in
 * Account Settings beside "Your access", which lists the same capacities.
 *
 * Only rendered when the caller holds more than one identity concurrently — an
 * organization plus their own individual membership, or two organizations.
 * Switching reissues the session cookie server-side
 * (`PUT /api/v1/users/current/identities/active`) and then reloads, so every
 * org-scoped screen re-fetches under the new context instead of holding stale
 * state from the previous one.
 */
import { useState } from "preact/hooks";
import { ApiClientError, putJson } from "../../../shared/api-client";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { Alert } from "../../../ui/Alert";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { myProfileSchema } from "../../../../shared/schemas/me";
import { useMembershipCategoryLabels } from "../../../hooks/useMembershipCategoryLabels";
import type { MyProfile } from "../types";

export function ActingIdentitySwitcher({ profile }: { profile: MyProfile }) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const categories = useMembershipCategoryLabels();

  if (profile.activeIdentities.length <= 1) return null;

  // The currently-active entry is whichever membership matches the
  // organization (or org-less-ness) this profile response is already scoped to.
  const activeIdentityId = profile.activeIdentities.find(
    (identity) => identity.organizationId === profile.organizationId,
  )?.identityId;

  async function handleSwitch(identityId: string): Promise<void> {
    if (identityId === activeIdentityId) return;
    setError(null);
    setSwitching(identityId);
    try {
      await putJson("/api/v1/users/current/identities/active", { identityId }, myProfileSchema);
      // A full reload rather than a navigation: the caller stays on this page,
      // so assigning the same URL would be a no-op and would leave every other
      // org-scoped screen holding state from the context just switched away
      // from.
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not switch membership. Please try again.");
      setSwitching(null);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Acting as" />
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-muted pk-small">
          You hold more than one active identity. Switch which exact identity the portal acts as below.
        </p>
        <ul class="pk-stack pk-stack--tight">
          {profile.activeIdentities.map((identity) => {
            const isActive = identity.identityId === activeIdentityId;
            return (
              <li key={identity.identityId} class="pk-cluster pk-cluster--between">
                <span>
                  {identity.organizationName ?? "My individual identity"}{" "}
                  <span class="pk-muted pk-small">({categories.label(identity.membershipCategory)})</span>
                </span>
                {isActive ? (
                  <Badge tone="ok">Current</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={switching !== null}
                    onClick={() => void handleSwitch(identity.identityId)}
                  >
                    {switching === identity.identityId ? "Switching…" : "Switch"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      </PanelBody>
    </Panel>
  );
}
