import type { z } from "zod";
import { promotionFormatSchema } from "../../../shared/schemas/event-promotion-kit";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";

type Format = z.infer<typeof promotionFormatSchema>;

export const KIT_FORMAT_NAMES: Record<Format, string> = {
  portrait: "Tall post",
  carousel: "Carousel",
  square: "Square post",
  landscape: "Wide post",
};

const FORMAT_SHAPES: Record<Format, string> = {
  portrait: "4:5 image",
  carousel: "PDF slides",
  square: "1:1 image",
  landscape: "1.91:1 image",
};

export const RECOMMENDED_KIT_FORMATS: readonly Format[] = ["portrait", "carousel"];

/** What a message to scheduled speakers carries; who receives it stays with the audience filters. */
export function SpeakerKitAttachments({
  available,
  attached,
  formats,
  resend,
  formatsField,
  onAttachedChange,
  onFormatsChange,
  onResendChange,
}: {
  available: boolean;
  attached: boolean;
  formats: readonly Format[];
  resend: boolean;
  formatsField: FieldPresentation;
  onAttachedChange: (attached: boolean) => void;
  onFormatsChange: (formats: Format[]) => void;
  onResendChange: (resend: boolean) => void;
}) {
  return (
    <Field label="Attachments" group>
      {() => (
        <div class="pk-stack pk-stack--snug">
          <Checkbox
            label="Each speaker’s promotion kit"
            hint={
              available
                ? "Sends one email per session, with that speaker’s own files."
                : "Available when Speaker status is Scheduled on the agenda."
            }
            disabled={!available}
            checked={available && attached}
            onChange={(event) => onAttachedChange((event.target as HTMLInputElement).checked)}
          />
          {available && attached && (
            <>
              <Field
                label="Formats"
                group
                help="Speakers can open their kit from the email to customize it or get other formats."
                {...formatsField}
              >
                {() => (
                  <div class="pk-stack pk-stack--tight">
                    {(["portrait", "carousel", "square", "landscape"] as const).map((format) => (
                      <Checkbox
                        key={format}
                        name="kit.formats"
                        label={`${KIT_FORMAT_NAMES[format]} (${FORMAT_SHAPES[format]})`}
                        hint={RECOMMENDED_KIT_FORMATS.includes(format) ? "Recommended" : undefined}
                        checked={formats.includes(format)}
                        onChange={(event) =>
                          onFormatsChange(
                            (event.target as HTMLInputElement).checked
                              ? [...formats, format]
                              : formats.filter((item) => item !== format),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </Field>
              <Checkbox
                label="Also email speakers who already received this kit"
                checked={resend}
                onChange={(event) => onResendChange((event.target as HTMLInputElement).checked)}
              />
            </>
          )}
        </div>
      )}
    </Field>
  );
}
