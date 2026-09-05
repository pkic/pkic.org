import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { Badge, Menu, PersonCell } from "pkic-org-events-backend";

/**
 * Menu owns its open state — there is no `open` prop — so a statically
 * rendered cell would show nothing but the ⋯ trigger. Each cell therefore
 * activates its own trigger once on mount, which is the same code path a
 * click takes, so the popup in the sheet is the real popup with its real
 * placement.
 *
 * The subject sits in a roomy grid column rather than across the full width:
 * the popup is `fixed` and measures itself against the space to the right of
 * its trigger, so a trigger pinned to the far edge of the preview card would
 * be shown a squeezed popup that the product never renders.
 */

const noop = () => {};

function Opened({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = host.current?.querySelector(".pk-menu__trigger") as HTMLButtonElement | null;
    if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  }, []);

  return (
    <div ref={host} class="pk pk-grid pk-grid--roomy">
      {children}
    </div>
  );
}

export function RowMenu() {
  return (
    <Opened>
      <div class="pk-stack pk-stack--tight">
        <span class="pk-small pk-muted">Post-Quantum Cryptography — members</span>
        <div class="pk-cluster pk-cluster--between">
          <PersonCell name="Tomas Riedel" email="tomas.riedel@example.org" />
          <Menu
            label="Actions for Tomas Riedel"
            heading="Tomas Riedel"
            align="end"
            items={[
              { id: "profile", label: "View profile", onSelect: noop },
              { id: "capacity", label: "Change capacity", onSelect: noop },
              { id: "transfer", label: "Transfer group", onSelect: noop, disabled: true },
              { id: "remove", label: "Remove from group", onSelect: noop, danger: true, separatorBefore: true },
            ]}
          />
        </div>
      </div>
    </Opened>
  );
}

export function ChoiceMenu() {
  return (
    <Opened>
      <div class="pk-stack pk-stack--tight">
        <span class="pk-small pk-muted">Sorted by organization name, ascending</span>
        <div class="pk-cluster pk-cluster--between">
          <span class="pk-strong">Member organizations</span>
          <Menu
            label="Sort organizations"
            heading="Sort by"
            align="end"
            items={[
              { id: "name", label: "Organization", onSelect: noop, checked: true },
              { id: "joined", label: "Date joined", onSelect: noop, checked: false },
              { id: "renewal", label: "Renewal date", onSelect: noop, checked: false },
              { id: "asc", label: "Ascending", onSelect: noop, checked: true, separatorBefore: true },
              { id: "desc", label: "Descending", onSelect: noop, checked: false },
            ]}
          />
        </div>
      </div>
    </Opened>
  );
}

export function PlainTrigger() {
  return (
    <Opened>
      <div class="pk-stack pk-stack--tight">
        <span class="pk-small pk-muted">Portal sidebar — signed in</span>
        <div class="pk-cluster pk-cluster--between">
          <Menu
            label="Account menu for Amara Osei"
            variant="plain"
            items={[
              { id: "account", label: "Account settings", onSelect: noop },
              { id: "organization", label: "Switch organization", onSelect: noop },
              { id: "sign-out", label: "Sign out", onSelect: noop, separatorBefore: true },
            ]}
          >
            <PersonCell name="Amara Osei" email="DigiCert — Executive Council" />
          </Menu>
          <Badge tone="neutral">Chair</Badge>
        </div>
      </div>
    </Opened>
  );
}
