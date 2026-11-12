import type { PromotionMaterialFile } from "../../../shared/schemas/event-email-campaigns";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { KIT_FORMAT_NAMES } from "./SpeakerKitAttachments";

const BADGE_NAMES = { landscape: "Wide badge", square: "Square badge" } as const;

function fileName(file: PromotionMaterialFile): string {
  if (file.kit === "badge") return BADGE_NAMES[file.format];
  return `${KIT_FORMAT_NAMES[file.format]}, ${file.kit === "attendee" ? "attendee kit" : "session kit"}`;
}

/** The files picked from one person's promotion materials; the email waits until each is ready. */
export function PromotionMaterialAttachments({
  files,
  onReview,
}: {
  files: readonly PromotionMaterialFile[];
  /** Opens the person's materials to view, download, or change the picked files. */
  onReview?: () => void;
}) {
  return (
    <Field label="Attachments" group help="The email goes out once every file is ready.">
      {() => (
        <div class="pk-stack pk-stack--tight">
          <ul class="pk-stack pk-stack--tight pk-small">
            {files.map((file) => (
              <li key={JSON.stringify(file)}>{fileName(file)}</li>
            ))}
          </ul>
          {onReview && (
            <div>
              <Button onClick={onReview}>Review files</Button>
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
