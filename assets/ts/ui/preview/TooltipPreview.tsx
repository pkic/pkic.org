import { Tooltip } from "../Tooltip";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconPlus } from "../../components/icons";
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
            </div>
          }
        >
          <Badge dot={false}>3 days</Badge>
        </Tooltip>
      </span>
    </div>
  );
}
