import { useState } from "preact/hooks";
import { BadgeOutputProgress } from "../../components/event-badges/BadgeOutputProgress";
import { Button } from "../Button";
import type { PreviewSection } from "./PreviewShell";

function OutputProgressExample() {
  const [open, setOpen] = useState(false);
  return (
    <div data-gallery-open>
      <Button onClick={() => setOpen(true)}>Print labels</Button>
      {open && (
        <BadgeOutputProgress
          title="Print labels"
          progress="Preparing artwork… 1,500 of 3,000"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export const badgeOutputProgressSection: PreviewSection = {
  id: "badge-output-progress",
  title: "Attendee output progress",
  note: "One cancellable task over the registration list, without layout controls or partially displayed labels.",
  render: () => <OutputProgressExample />,
};
