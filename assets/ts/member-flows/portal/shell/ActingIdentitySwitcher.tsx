/**
 * Which identity the portal acts as — chosen on arrival, switched from the
 * account menu.
 *
 * This is not a fact about a person, so it does not belong on a person's
 * record: it is a setting on this session, deciding which organization (or
 * the person's individual capacity) the working groups, votes, applications
 * and audit records around it speak for. Both places use the same labels and
 * the same selection, which reissues the session server-side and remembers the
 * choice on this device.
 */
import { useState } from "preact/hooks";
import { ApiClientError } from "../../../shared/api-client";
import { actingIdentityLabel } from "../../../shared/acting-identity-catalog";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import type { MenuItem } from "../../../ui/Menu";
import { selectActingIdentity } from "../acting-identity";
import type { PortalSession } from "../types";
import { LoginFrame } from "./LoginFrame";

const SWITCH_FAILED = "Could not switch identity. Please try again.";

function switchErrorMessage(cause: unknown): string {
  return cause instanceof ApiClientError ? cause.message : SWITCH_FAILED;
}

/** Asked once after sign-in when a person holds several identities and this device remembers no choice. */
export function ActingIdentitySwitcher({
  session,
  onChosen,
}: {
  session: PortalSession;
  onChosen: (next: PortalSession) => void | Promise<void>;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(identityId: string): Promise<void> {
    setError(null);
    setChoosing(identityId);
    try {
      await onChosen(await selectActingIdentity(session, identityId));
    } catch (cause) {
      setError(switchErrorMessage(cause));
      setChoosing(null);
    }
  }

  return (
    <LoginFrame
      label="Choose an identity"
      title="Choose an identity"
      lede="You hold more than one identity. Choose which one the portal acts for; you can switch at any time from the account menu."
      busy={choosing !== null}
    >
      <fieldset class="pk-login__controls pk-stack" disabled={choosing !== null}>
        {session.actingIdentities.map((identity) => (
          <Button
            key={identity.id}
            variant="secondary"
            loading={choosing === identity.id}
            onClick={() => void choose(identity.id)}
          >
            Continue as {actingIdentityLabel(identity)}
          </Button>
        ))}
      </fieldset>
      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
    </LoginFrame>
  );
}

/**
 * The account menu's view of the acting identity: a heading naming it and,
 * for a person with several, a "Switch identity" submenu. Switching reloads
 * the page so every organization-scoped screen re-fetches under the new
 * identity instead of holding state from the one just left.
 */
export function useActingIdentityMenu(session: PortalSession | null): {
  heading: string | undefined;
  items: MenuItem[];
  error: string | null;
} {
  const [error, setError] = useState<string | null>(null);
  const acting = session?.actingIdentities.find((identity) => identity.id === session.actingIdentityId);
  if (!session || session.actingIdentities.length <= 1) {
    return { heading: acting ? `Acting as ${actingIdentityLabel(acting)}` : undefined, items: [], error: null };
  }

  async function switchTo(current: PortalSession, identityId: string): Promise<void> {
    if (identityId === current.actingIdentityId) return;
    setError(null);
    try {
      await selectActingIdentity(current, identityId);
      window.location.reload();
    } catch (cause) {
      setError(switchErrorMessage(cause));
    }
  }

  return {
    heading: acting ? `Acting as ${actingIdentityLabel(acting)}` : undefined,
    items: [
      {
        id: "acting-identity",
        label: "Switch identity",
        children: session.actingIdentities.map((identity) => ({
          id: `acting-identity-${identity.id}`,
          label: actingIdentityLabel(identity),
          checked: identity.id === session.actingIdentityId,
          onSelect: () => void switchTo(session, identity.id),
        })),
      },
    ],
    error,
  };
}
