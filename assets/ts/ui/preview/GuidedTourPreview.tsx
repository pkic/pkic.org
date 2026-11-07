import type { PreviewSection } from "./PreviewShell";
import { useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { GuidedTour } from "../GuidedTour";

export function GuidedTourPreview() {
  const scope = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div ref={scope} class="pk-stack">
      <div>
        <Button data-tour-subject="action">Print labels</Button>
      </div>
      <p data-tour-subject="results">Recent results appear here.</p>
      <span data-gallery-open>
        <Button data-tour-trigger onClick={() => setOpen(true)}>
          Show help tour
        </Button>
      </span>
      {open && (
        <GuidedTour
          scope={scope}
          onClose={() => setOpen(false)}
          steps={[
            {
              id: "action",
              target: '[data-tour-subject="action"]',
              title: "Print selected labels",
              body: "The tour points to its subject. Next shows the following control.",
            },
            {
              id: "results",
              target: '[data-tour-subject="results"]',
              title: "Review results",
              body: "Use Back to revisit a step, or Done to return to your work.",
            },
          ]}
        />
      )}
    </div>
  );
}

export const guidedTourSection: PreviewSection = {
  id: "guided-tour",
  title: "Guided tour",
  note: "Anchored help with highlighted subjects and brand-gradient progress.",
  render: () => <GuidedTourPreview />,
};
