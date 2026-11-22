import { useRef } from "preact/hooks";
import { ControlTooltips } from "../ControlTooltips";
import { Tooltip } from "../Tooltip";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconLayoutReset, IconPlus } from "../../components/icons";
export function TooltipPreview() {
  return (
    <div class="pk-preview__shelf">
      <Button icon aria-label="Add a speaker" title="Add a speaker">
        <IconPlus />
      </Button>
      <span data-gallery-open="focus">
        <Tooltip
          label="In person, three days"
          content={
            <div class="pk-stack pk-stack--tight">
              <strong>In person</strong>
              <span>2 not waitlisted · 1 waitlisted</span>
              <span>December 1 · Not waitlisted</span>
              <span>December 2 · Waitlisted</span>
              <span>December 3 · Not waitlisted</span>
            </div>
          }
        >
          <Badge dot={false}>3 days</Badge>
        </Tooltip>
      </span>
    </div>
  );
}

/** A surface with `ControlTooltips`: a coded control and an icon control, each with a hint in the house style. */
export function ControlTooltipPreview() {
  const surface = useRef<HTMLDivElement>(null);
  return (
    <div ref={surface} class="pk-preview__shelf" data-density="compact">
      <ControlTooltips scope={surface} />
      <span data-gallery-open="focus">
        <Button
          aria-pressed={false}
          aria-label="Show Sam Speaker on air"
          title={"Off air\nClick to put it on air now. Preview is not needed first."}
        >
          PGM
        </Button>
      </span>
      <Button
        icon
        aria-label="Reset layout"
        title={"Reset layout\nPut this workspace's panels back where they started. Nothing on air changes."}
      >
        <IconLayoutReset />
      </Button>
    </div>
  );
}
