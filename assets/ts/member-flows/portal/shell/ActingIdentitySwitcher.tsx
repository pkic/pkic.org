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
import {
  actingIdentityLabel,
  orderedForChoice,
  PERSONAL_IDENTITY_LABEL,
} from "../../../shared/acting-identity-catalog";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { Alert } from "../../../ui/Alert";
import { Avatar } from "../../../ui/Avatar";
import { Button } from "../../../ui/Button";
import { PkicMark } from "../../../ui/PkicMark";
import type { MenuItem } from "../../../ui/Menu";
import { selectActingIdentity } from "../acting-identity";
import type { PortalSession } from "../types";
import { LoginFrame } from "./LoginFrame";

const SWITCH_FAILED = "Could not switch identity. Please try again.";

type ActingIdentityChoice = PortalSession["actingIdentities"][number];

/**
 * A choice on the chooser: "Personal", or the organization's name. The job
 * title and address are added only where two choices would otherwise read the
 * same, which a first-time attendee choosing between themself and their
 * employer never needs.
 */
function choiceLabel(identity: ActingIdentityChoice, all: readonly ActingIdentityChoice[]): string {
  const short = identity.organizationName ?? PERSONAL_IDENTITY_LABEL;
  const ambiguous = all.some(
    (other) => other.id !== identity.id && (other.organizationName ?? PERSONAL_IDENTITY_LABEL) === short,
  );
  return ambiguous ? actingIdentityLabel(identity) : short;
}

/** What the identity does, and the membership it holds, on one line; the title is left out when the name already carries it. */
function choiceDetail(identity: ActingIdentityChoice, shownName: string): string {
  const title = identity.jobTitle && !shownName.includes(identity.jobTitle) ? identity.jobTitle : null;
  return [title, identity.membershipLabel ?? identity.membershipCategory].filter(Boolean).join(" \u00b7 ");
}

/** The account menu's heading: "Acting as Northwind Review Labs", or "Acting personally". */
function actingHeading(identity: ActingIdentityChoice): string {
  return identity.organizationName ? `Acting as ${actingIdentityLabel(identity)}` : "Acting personally";
}

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
  const choices = orderedForChoice(session.actingIdentities);
  // Only an organization is suggested; with just a personal identity there is nothing to recommend.
  const suggested = Boolean(choices[0]?.organizationId);

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
      label="Choose how you take part"
      title="Choose how you take part"
      lede="Take part for your organization where you can. You can switch at any time from the account menu."
      busy={choosing !== null}
    >
      <fieldset class="pk-login__controls pk-identity-choices" disabled={choosing !== null}>
        {choices.map((identity, index) => (
          <Button
            key={identity.id}
            variant={index === 0 && suggested ? "primary" : "secondary"}
            loading={choosing === identity.id}
            onClick={() => void choose(identity.id)}
          >
            <span class="pk-identity-choice">
              <Avatar
                name={identity.organizationName ?? session.identity.email}
                src={
                  identity.organizationId
                    ? `/api/v1/members/${encodeURIComponent(identity.organizationId)}/logo`
                    : undefined
                }
                shape={identity.organizationName || identity.membershipCategory ? "square" : "round"}
                size="lg"
              />
              <span class="pk-identity-choice__body">
                <span class="pk-identity-choice__name">{choiceLabel(identity, session.actingIdentities)}</span>
                <span class="pk-identity-choice__detail">
                  {choiceDetail(identity, choiceLabel(identity, session.actingIdentities))}
                </span>
              </span>
              {identity.membershipCategory && (
                <span class="pk-identity-choice__mark" aria-hidden="true">
                  <PkicMark />
                </span>
              )}
            </span>
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
  /** The account menu's "Switch identity" submenu, or nothing for a person with one identity. */
  items: MenuItem[];
  /** The identities to switch between, flat, for a control that is itself the switch. */
  choices: MenuItem[];
  error: string | null;
} {
  const [error, setError] = useState<string | null>(null);
  const acting = session?.actingIdentities.find((identity) => identity.id === session.actingIdentityId);
  if (!session || session.actingIdentities.length <= 1) {
    return { heading: acting ? actingHeading(acting) : undefined, items: [], choices: [], error: null };
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

  const choices: MenuItem[] = orderedForChoice(session.actingIdentities).map((identity) => ({
    id: `acting-identity-${identity.id}`,
    label: actingIdentityLabel(identity),
    checked: identity.id === session.actingIdentityId,
    onSelect: () => void switchTo(session, identity.id),
  }));

  return {
    heading: acting ? actingHeading(acting) : undefined,
    items: [{ id: "acting-identity", label: "Switch identity", children: choices }],
    choices,
    error,
  };
}
