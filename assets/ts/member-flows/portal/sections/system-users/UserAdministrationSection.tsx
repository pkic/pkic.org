/**
 * The administrative surfaces of a person's record, out of the way of it.
 *
 * A contact record is about the person: what they do, who they represent, what
 * they have earned. Changing their name, managing the addresses their account
 * answers to and replacing their photograph are none of those things — they
 * are operations on the account, done rarely, by someone who came to do them.
 * They used to sit at the foot of the record as three more panels, which put
 * an upload control and a form in the same reading order as the person's
 * standing.
 *
 * So they are disclosed rather than removed: one control names what is behind
 * it, and nothing is lost for the reader who needs it. `hidden` rather than
 * unmounting, so a half-typed address survives the section being closed by
 * mistake.
 */
import { useId, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

import { Menu } from "../../../../ui/Menu";
import { Panel, PanelHeader } from "../../../../ui/Panel";

export function UserAdministrationSection({ children }: { children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  return (
    <div class="pk-stack">
      {/*
        A header and nothing else: a bar that names what is behind it. The
        paragraph that used to sit under it explained the title and no more,
        which is a panel's worth of chrome spent on a sentence nobody needs
        twice.
      */}
      <Panel>
        <PanelHeader title="Account administration">
          <Menu
            label="Account administration"
            align="end"
            items={[
              {
                id: "toggle",
                label: open ? "Hide account administration" : "Show account administration",
                onSelect: () => {
                  setOpen(!open);
                },
              },
            ]}
          />
        </PanelHeader>
      </Panel>

      {/*
        `hidden` keeps the surfaces mounted, so their unsaved state — a typed
        address, an opened profile form — survives a mistaken close. The
        attribute takes them out of the accessibility tree the same way display
        would, so nothing collapsed is announced.
      */}
      <div class="pk-stack" id={regionId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
