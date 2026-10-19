import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Button } from "../../../../../../ui/Button";
import { materialStatusLabels } from "./session-material-labels";
import { ExternalLink } from "../../../../../../ui/ExternalLink";

/**
 * Slides are uploaded, reviewed and released in the session's materials, never typed in here.
 * The stored slides link mirrors the released material, or an imported historical link.
 */
export function SessionSlidesStatus({
  occurrence,
  onManage,
  blocked,
}: {
  occurrence?: AgendaOccurrence;
  onManage?: () => void;
  /** Unsaved edits would be lost by leaving the editor. */
  blocked: boolean;
}) {
  const slides = (occurrence?.history?.materials ?? []).filter((material) => material.kind === "presentation");
  const current = slides.find((material) => material.status === "approved") ?? slides[0];
  const status = current
    ? `${materialStatusLabels[current.status]} · version ${formatNumber(current.version)}`
    : occurrence?.presentationUrl
      ? "Imported link, no uploaded version"
      : "No slides yet";
  return (
    <div class="pk-agenda-editor__form-wide pk-stack pk-stack--snug">
      <DescriptionList
        density="compact"
        items={[
          { term: "Slides", value: status },
          ...(occurrence?.presentationUrl
            ? [
                {
                  term: "Slides link",
                  value: (
                    <ExternalLink href={occurrence.presentationUrl} external>
                      {occurrence.presentationUrl}
                    </ExternalLink>
                  ),
                },
              ]
            : []),
        ]}
      />
      {occurrence && onManage ? (
        <div class="pk-cluster">
          <Button type="button" disabled={blocked} onClick={onManage}>
            Manage slides
          </Button>
          {blocked && <span class="pk-agenda-editor__notice">Save or cancel your changes before managing slides.</span>}
        </div>
      ) : (
        <p class="pk-agenda-editor__notice">
          {occurrence
            ? "Upload and release slides from Materials and archive in the session menu."
            : "Save the session first; slides are then uploaded from its materials."}
        </p>
      )}
    </div>
  );
}
