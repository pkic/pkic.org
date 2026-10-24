import { PromotionSessionPicks } from "./PromotionSessionPicks";
import { useState } from "preact/hooks";
import {
  promotionCompositionSaveSchema,
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
export function PromotionCompositionEditor({
  kit,
  base,
  onSaved,
}: {
  kit: Kit;
  base: string;
  onSaved: (kit: Kit) => void;
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
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved(await postJson(`${base}/composition`, checked.data, promotionKitSchema));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your kit.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form noValidate onSubmit={save} class="pk-form">
      <p>
        Adjust your own materials. The event details, speaker profiles, sponsors, and your referral link stay connected
        to their official records.
      </p>
      <Field
        label="Panels"
        help="Choose panels, then move them into the order you want."
        {...form.of("composition.panels")}
      >
        {() => (
          <div class="pk-stack">
            {promotionPanelSchema.options
              .filter((key) =>
                kit.audience !== "attendee"
                  ? !["picks"].includes(key)
                  : !["speakers", "content", "details"].includes(key),
              )
              .map((key) => (
                <Checkbox
                  key={key}
                  label={labels[key]}
                  checked={composition.panels.includes(key)}
                  onChange={(event) =>
                    change(
                      "panels",
                      event.currentTarget.checked
                        ? [...composition.panels, key]
                        : composition.panels.filter((value) => value !== key),
                    )
                  }
                />
              ))}
            <ol>
              {composition.panels.map((key, index) => (
                <li key={key}>
                  {labels[key]}{" "}
                  <Button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      const panels = [...composition.panels];
                      [panels[index - 1], panels[index]] = [panels[index]!, panels[index - 1]!];
                      change("panels", panels);
                    }}
                  >
                    Move {labels[key].toLowerCase()} earlier
                  </Button>
                </li>
              ))}
            </ol>
          </div>
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
                <option value="auto">Use takeaways when available</option>
                <option value="takeaways">Key takeaways</option>
                <option value="abstract">Session abstract</option>
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
          <Field label="Your key takeaways" help="Optional. One point per line." {...form.of("composition.takeaways")}>
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
            <option value="subtle">Subtle</option>
            <option value="bold">More prominent</option>
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
            <option value="compact">Compact</option>
            <option value="expanded">Expanded</option>
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
      {error && <ErrorAlert error={error} />}
      <Button type="submit" disabled={busy}>
        Save my materials
      </Button>
    </form>
  );
}
