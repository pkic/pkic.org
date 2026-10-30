import { PromotionSessionPicks } from "./PromotionSessionPicks";
import { useState } from "preact/hooks";
import {
  promotionCompositionSaveSchema,
  promotionCompositionSchema,
  promotionPanelSchema,
  defaultPromotionComposition,
  type PromotionComposition,
} from "../../../../../../../shared/schemas/event-promotion-design";
import { promotionKitSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import type { z } from "zod";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Textarea, TextInput, Select } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { IconChevron } from "../../../../../../ui/MediaIcons";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
type Kit = z.infer<typeof promotionKitSchema>;
const labels: Record<z.infer<typeof promotionPanelSchema>, string> = {
  cover: "Cover",
  speakers: "Speakers",
  content: "About the session",
  details: "When and where",
  picks: "My selected sessions",
  register: "Registration",
  sponsors: "Sponsors",
};
const contentLabels: Record<PromotionComposition["content"], string> = {
  auto: "Use takeaways when available",
  takeaways: "Key takeaways",
  abstract: "Session abstract",
};
const overlapLabels: Record<PromotionComposition["overlap"], string> = {
  subtle: "Subtle",
  bold: "More prominent",
};
const stillLayoutLabels: Record<PromotionComposition["stillLayout"], string> = {
  compact: "Compact",
  expanded: "Expanded",
};

export function PromotionCompositionEditor({
  kit,
  open = true,
  base,
  onSaved,
  onCancel,
}: {
  kit: Kit;
  open?: boolean;
  base: string;
  onSaved: (kit: Kit) => void;
  onCancel: () => void;
}) {
  const [composition, setComposition] = useState<PromotionComposition>(
    kit.composition ?? defaultPromotionComposition(kit.audience === "attendee"),
  );
  const [takeawayText, setTakeawayText] = useState(composition.takeaways.join("\n"));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const body = { expectedRevision: kit.compositionRevision, composition };
  const form = useContractForm(promotionCompositionSaveSchema, body);
  const change = <K extends keyof PromotionComposition>(key: K, value: PromotionComposition[K]) =>
    setComposition({ ...composition, [key]: value });
  async function save() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    try {
      onSaved(await postJson(`${base}/composition`, checked.data, promotionKitSchema));
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      title="Personalize promotion materials"
      closeLabel="Close promotion editor"
      confirmLabel="Save my materials"
      confirmDisabled={busy}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        class="pk-form"
      >
        <p>
          Adjust your own materials. The event details, speaker profiles, sponsors, and your referral link stay
          connected to their official records.
        </p>
        <Field label="Panels" help="Choose panels and arrange their order." {...form.of("composition.panels")}>
          {() => (
            <ol class="pk-promotion-kit__panels" data-density="compact">
              {[
                ...composition.panels,
                ...promotionPanelSchema.options.filter(
                  (key) =>
                    !composition.panels.includes(key) &&
                    (kit.audience === "attendee" ? !["speakers", "content", "details"].includes(key) : key !== "picks"),
                ),
              ].map((key) => {
                const index = composition.panels.indexOf(key);
                return (
                  <li key={key}>
                    <Checkbox
                      fill
                      label={labels[key]}
                      checked={index >= 0}
                      onChange={(event) =>
                        change(
                          "panels",
                          event.currentTarget.checked
                            ? [...composition.panels, key]
                            : composition.panels.filter((value) => value !== key),
                        )
                      }
                    />
                    {index >= 0 && (
                      <span class="pk-promotion-kit__actions">
                        {([-1, 1] as const).map((direction) => {
                          const label = `Move ${labels[key].toLowerCase()} ${direction === -1 ? "up" : "down"}`;
                          return (
                            <Button
                              icon
                              aria-label={label}
                              title={label}
                              disabled={index + direction < 0 || index + direction >= composition.panels.length}
                              onClick={() => {
                                const panels = [...composition.panels];
                                [panels[index], panels[index + direction]] = [
                                  panels[index + direction]!,
                                  panels[index]!,
                                ];
                                change("panels", panels);
                              }}
                            >
                              <IconChevron pointing={direction === -1 ? "up" : "down"} />
                            </Button>
                          );
                        })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Field>
        {kit.audience === "attendee" && (
          <Field label="Sessions to share" {...form.of("composition.sessionIds")}>
            {() => (
              <PromotionSessionPicks
                base={base}
                selected={composition.sessionIds}
                onChange={(ids) => change("sessionIds", ids)}
              />
            )}
          </Field>
        )}
        {kit.audience === "speaker" && (
          <>
            <Field label="Session content" {...form.of("composition.content")}>
              {(control) => (
                <Select
                  {...control}
                  value={composition.content}
                  onChange={(event) => change("content", event.currentTarget.value as PromotionComposition["content"])}
                >
                  {promotionCompositionSchema.shape.content.unwrap().options.map((value) => (
                    <option key={value} value={value}>
                      {contentLabels[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Your short description"
              help="Leave blank to use the reviewed session description."
              {...form.of("composition.summary")}
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={composition.summary}
                  onInput={(event) => change("summary", event.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              label="Your key takeaways"
              help="Optional. One point per line."
              {...form.of("composition.takeaways")}
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={takeawayText}
                  onInput={(event) => {
                    setTakeawayText(event.currentTarget.value);
                    change(
                      "takeaways",
                      event.currentTarget.value.split("\n").filter((value) => value.trim()),
                    );
                  }}
                />
              )}
            </Field>
          </>
        )}
        <Field label="Call to action" {...form.of("composition.callToAction")}>
          {(control) => (
            <TextInput
              {...control}
              value={composition.callToAction}
              onInput={(event) => change("callToAction", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Overlap between panels" {...form.of("composition.overlap")}>
          {(control) => (
            <Select
              {...control}
              value={composition.overlap}
              onChange={(event) => change("overlap", event.currentTarget.value as PromotionComposition["overlap"])}
            >
              {promotionCompositionSchema.shape.overlap.unwrap().options.map((value) => (
                <option key={value} value={value}>
                  {overlapLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Still-image layout" {...form.of("composition.stillLayout")}>
          {(control) => (
            <Select
              {...control}
              value={composition.stillLayout}
              onChange={(event) =>
                change("stillLayout", event.currentTarget.value as PromotionComposition["stillLayout"])
              }
            >
              {promotionCompositionSchema.shape.stillLayout.unwrap().options.map((value) => (
                <option key={value} value={value}>
                  {stillLayoutLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Event artwork" {...form.of("composition.motif")}>
          {(control) => (
            <Checkbox
              {...control}
              label="Include the event’s decorative artwork"
              checked={composition.motif}
              onChange={(event) => change("motif", event.currentTarget.checked)}
            />
          )}
        </Field>
        <Field
          label="Print option"
          help="Digital materials already include your personal link."
          {...form.of("composition.qrCode")}
        >
          {(control) => (
            <Checkbox
              {...control}
              label="Include a QR code for print or a second screen"
              checked={composition.qrCode}
              onChange={(event) => change("qrCode", event.currentTarget.checked)}
            />
          )}
        </Field>
        {error && <ErrorAlert error={error} />}
      </form>
    </Dialog>
  );
}
