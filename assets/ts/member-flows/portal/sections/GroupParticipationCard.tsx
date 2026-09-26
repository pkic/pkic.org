/**
 * One group on its own page: what it is, which of the viewer's affiliations
 * participate, and the joins and leaves available from here.
 *
 * It used to be the catalog's row as well, one card per group down a list
 * (#51). The catalog is a table now; this stays for the single group a reader
 * has opened, where a card is the right shape because the group is the
 * subject of the page rather than one line in a list of them.
 *
 * The commands are the shared ones either surface uses, so joining means the
 * same thing in both — including how it asks on whose behalf, which is the
 * confirmation's job rather than a column of checkboxes standing open.
 */
import { useState } from "preact/hooks";
import type { SelfGroup } from "../../../../shared/schemas/group-participation";
import { Badge } from "../../../ui/Badge";
import { Button, ButtonLink } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { RowActions } from "../../../ui/RowActions";
import { fmtDate } from "../ui";
import {
  affiliationLabel,
  availableCapacities,
  joinGroupOnBehalf,
  leaveGroupAsCapacity,
  leaveGroupEntirely,
} from "./group-participation-commands";

export function GroupParticipationCard({ group, onChanged }: { group: SelfGroup; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const available = availableCapacities(group);

  async function run(command: () => Promise<boolean>): Promise<void> {
    setBusy(true);
    try {
      if (await command()) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel class="pk">
      <PanelHeader title="Your participation">
        {group.memberships.length > 0 && <Badge tone="ok">Joined</Badge>}
      </PanelHeader>
      <PanelBody class="pk-stack">
        {group.memberships.length === 0 && <p class="pk-small pk-muted">You have not joined this group yet.</p>}

        {group.memberships.length > 0 && (
          <div class="pk-stack pk-stack--snug">
            {/* A heading over a list of affiliations, not the label of a
                control. `pk-field__label` outside a `pk-field` is a part with
                no whole: there is no state here for it to carry. */}
            <p class="pk-small pk-strong">Participating as</p>
            <ul class="pk-stack pk-stack--tight" aria-label={`Affiliations participating in ${group.name}`}>
              {group.memberships.map((membership) => {
                const label = affiliationLabel({
                  memberId: membership.memberId,
                  memberType: membership.memberType,
                  organizationName: membership.organizationName,
                  membershipCategory: membership.membershipCategory,
                });
                return (
                  <li key={membership.id} class="pk-cluster pk-cluster--between">
                    <span>
                      {label} <span class="pk-small">since {fmtDate(membership.joinedAt)}</span>
                    </span>
                    <RowActions
                      subject={label}
                      actions={[
                        {
                          id: "remove",
                          label: "Remove",
                          disabled: busy,
                          onSelect: () => void run(() => leaveGroupAsCapacity(group, membership.memberId, label)),
                        },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div class="pk-cluster">
          {group.memberships.length > 0 && (
            // A destination, not an action, so it stays an anchor and merely
            // borrows the button's appearance.
            <ButtonLink href={`#/groups/${encodeURIComponent(group.id)}/meetings`} size="sm">
              Meetings and calendar
            </ButtonLink>
          )}
          {available.length > 0 && (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => joinGroupOnBehalf(group))}>
              {group.memberships.length > 0 ? "Join on behalf of…" : "Join group…"}
            </Button>
          )}
          {group.memberships.length > 1 && (
            <Button
              variant="danger-quiet"
              size="sm"
              loading={busy}
              onClick={() => void run(() => leaveGroupEntirely(group))}
            >
              Leave all
            </Button>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
