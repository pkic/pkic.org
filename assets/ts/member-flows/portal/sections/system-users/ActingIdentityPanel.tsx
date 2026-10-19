/**
 * Which identity the signed-in person is acting as right now, on their own
 * record, with the switch beside it.
 *
 * The account menu already names it, but that is one heading in a menu that
 * is closed most of the time. The record is where a person checks how they
 * appear, so it states the acting identity plainly and offers the same switch
 * the account menu does — the same choices, through the same hook.
 */
import { PERSONAL_IDENTITY_LABEL } from "../../../../shared/acting-identity-catalog";
import { Alert } from "../../../../ui/Alert";
import { Avatar } from "../../../../ui/Avatar";
import { buttonClasses } from "../../../../ui/button-classes";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { useActingIdentityMenu } from "../../shell/ActingIdentitySwitcher";
import type { PortalSession } from "../../types";
import "./ActingIdentityPanel.css";

export function ActingIdentityPanel({
  session,
  personName,
  identityName,
}: {
  session: PortalSession;
  personName: string;
  /** The acting identity's name as the record's entry states it, so both say the same thing. */
  identityName?: string;
}) {
  const menu = useActingIdentityMenu(session);
  const acting = session.actingIdentities.find((identity) => identity.id === session.actingIdentityId);
  if (!acting) return null;

  const name = identityName ?? acting.organizationName ?? PERSONAL_IDENTITY_LABEL;
  const canSwitch = menu.choices.length > 0;
  const speaksFor = acting.organizationName
    ? `Your groups, votes and registrations speak for ${acting.organizationName}`
    : "You take part in groups, votes and events in your own name";

  return (
    <Panel aria-label="Acting as">
      <PanelHeader title="Acting as" headingLevel={2} />
      <PanelBody class="pk-stack pk-stack--snug">
        {menu.error && <Alert tone="danger">{menu.error}</Alert>}
        <div class="pk-acting-identity">
          {acting.organizationName ? (
            <Avatar name={acting.organizationName} shape="square" size="md" />
          ) : (
            <Avatar name={personName} size="md" />
          )}
          <div class="pk-acting-identity__name">
            <span class="pk-strong">{name}</span>
            {acting.jobTitle && <span class="pk-small pk-muted">{acting.jobTitle}</span>}
          </div>
        </div>
        <p class="pk-small pk-muted">{canSwitch ? `${speaksFor} until you switch.` : `${speaksFor}.`}</p>
        {canSwitch && (
          <div>
            <Menu
              label="Switch identity"
              variant="plain"
              triggerClass={buttonClasses({ variant: "secondary" }, undefined)}
              items={menu.choices}
            >
              Switch identity
            </Menu>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
