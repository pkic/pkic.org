/**
 * The administrative surfaces of a person's record, out of the way of it.
 *
 * A contact record is about the person: what they do, who they represent, what
 * they have earned. Managing the addresses their account answers to is none of
 * those things — it is an operation on the account, done rarely, by someone
 * who came to do it. They used to sit at the foot of the record as more
 * panels, which put an upload control in the same reading order as the
 * person's standing.
 *
 * The photograph is no longer among them. A portrait is not administration:
 * it is the picture at the top of the record, and it is changed by clicking
 * it (#28).
 *
 * So they are disclosed rather than removed. The whole header opens them,
 * because the first version put that behind an unlabelled ⋯ and the result was
 * a record whose name could not be corrected by anybody who did not already
 * know where to look. A disclosure has to look like one.
 *
 * `hidden` rather than unmounting, so a half-typed address survives the
 * section being closed by mistake.
 */
import { useId, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

import "./UserAdministrationSection.css";

export function UserAdministrationSection({ children }: { children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  return (
    <div class="pk-stack">
      <button
        type="button"
        class="pk-admin-disclosure"
        /* Named explicitly: the bar also carries a summary line and a chevron,
           and a name assembled from its contents would read as all three. */
        aria-label="Account administration"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(!open)}
      >
        <span class="pk-strong">Account administration</span>
        <span class="pk-cluster">
          <span class="pk-small pk-muted">Email addresses</span>
          <span class="pk-small pk-muted" aria-hidden="true">
            {open ? "⌃" : "⌄"}
          </span>
        </span>
      </button>

      {/*
        `hidden` keeps the surfaces mounted, so their unsaved state — a typed
        address, an opened form — survives a mistaken close. The attribute
        takes them out of the accessibility tree the same way display would, so
        nothing collapsed is announced.
      */}
      <div class="pk-stack" id={regionId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
