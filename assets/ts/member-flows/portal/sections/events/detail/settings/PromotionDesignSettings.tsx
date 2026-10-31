import { useState } from "preact/hooks";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import {
  eventPromotionDesignFromSettings,
  type EventPromotionDesign,
} from "../../../../../../../shared/schemas/event-promotion-design";
import { bytesToBase64 } from "../../../../../../../shared/base64";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useEventSettingsSave } from "./useEventSettingsSave";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { FileInput } from "../../../../../../ui/FileInput";
import { EditActions } from "../../../../../../ui/EditActions";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
const artworkLabels = {
  logo: "Logo",
  mark: "Background mark",
  motif: "Decorative artwork",
  texture: "Background texture",
} as const;
export function PromotionDesignSettings({
  event,
  onUpdated,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
}) {
  const [design, setDesign] = useState(() => eventPromotionDesignFromSettings(event.name, event.settings));
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    promotionDesign: design,
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(event.slug, form, onUpdated);
  function reset() {
    setDesign(eventPromotionDesignFromSettings(event.name, event.settings));
    form.reset();
    setError("");
  }
  async function artwork(key: keyof EventPromotionDesign["assets"], file: File | null) {
    try {
      const value = file
        ? { mime: "image/svg+xml" as const, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
        : undefined;
      setDesign((current) => ({ ...current, assets: { ...current.assets, [key]: value } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read artwork.");
    }
  }
  return (
    <Panel aria-label="Promotion design">
      <form noValidate {...form.handlers} onSubmit={(submit) => void save(submit)}>
        <PanelHeader title="Promotion design">
          {event.capabilities.includes("write") && (
            <EditActions
              label="Promotion design actions"
              editing={editing}
              saving={saving}
              saveLabel="Save promotion design"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p>
            Artwork starts from this event’s badge design. Change it here for another location or promotion style.
            Sponsors come from the event’s current public sponsorships.
          </p>
          {editing ? (
            <>
              <Field label="Design name" {...form.of("promotionDesign.name")}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={design.name}
                    onInput={(input) => setDesign({ ...design, name: input.currentTarget.value })}
                  />
                )}
              </Field>
              {design.colors.map((color, index) => (
                <Field
                  key={index}
                  label={`Gradient color ${index + 1}`}
                  {...form.of(`promotionDesign.colors.${index}`)}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      type="color"
                      value={color}
                      onInput={(input) =>
                        setDesign({
                          ...design,
                          colors: design.colors.map((value, i) => (i === index ? input.currentTarget.value : value)),
                        })
                      }
                    />
                  )}
                </Field>
              ))}
              {(Object.keys(artworkLabels) as (keyof typeof artworkLabels)[]).map((key) => (
                <Field
                  key={key}
                  label={artworkLabels[key]}
                  help="Use an SVG file with outlined text and no external resources."
                  {...form.of(`promotionDesign.assets.${key}`)}
                >
                  {(control) => (
                    <FileInput
                      {...control}
                      accept=".svg,image/svg+xml"
                      disabled={saving}
                      onFileChange={(file) => void artwork(key, file)}
                      preview={
                        design.assets[key] ? (
                          <img
                            src={`data:image/svg+xml;base64,${design.assets[key]!.base64}`}
                            width="120"
                            height="80"
                            alt={`${artworkLabels[key]} preview`}
                          />
                        ) : undefined
                      }
                    />
                  )}
                </Field>
              ))}
              <Field label="Streaming wording" {...form.of("promotionDesign.advertiseLiveStreaming")}>
                {(control) => (
                  <Checkbox
                    {...control}
                    checked={design.advertiseLiveStreaming}
                    label="Allow online wording for sessions whose current plan includes livestreaming"
                    hint="Leave off when plans are tentative. Recording is never promised automatically."
                    onChange={(input) => setDesign({ ...design, advertiseLiveStreaming: input.currentTarget.checked })}
                  />
                )}
              </Field>
            </>
          ) : (
            <p>
              {design.name} ·{" "}
              {design.advertiseLiveStreaming
                ? "Online wording follows the session plan"
                : "No automatic streaming or recording promises"}
            </p>
          )}
          {error && <ErrorAlert error={error} />}
        </PanelBody>
      </form>
    </Panel>
  );
}
