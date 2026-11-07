import { cropImage } from "../../../../../../shared/headshot/crop";
import { toast } from "../../../../ui";
import {
  EVENT_HERO_IMAGE_GUIDANCE,
  EVENT_HERO_IMAGE_WIDTH,
  EVENT_HERO_IMAGE_HEIGHT,
  eventHeroImageFormSchema,
} from "../../../../../../../shared/schemas/event-hero-image";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Field } from "../../../../../../ui/Field";
import { Radio } from "../../../../../../ui/Checkbox";
import { TextInput } from "../../../../../../ui/TextControl";
import { PictureTile } from "../../../../../../components/PictureTile";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { IMAGE_UPLOAD_ALLOWED_MIME_TYPES } from "../../../../../../../shared/schemas/images";

export function EventHeroImageField({
  file,
  image,
  onFileChange,
  onImageChange,
  onDimensions,
  fieldFor,
}: {
  file: File | null;
  image: string;
  onFileChange: (file: File | null) => void;
  onImageChange: (value: string) => void;
  onDimensions: (value: { width: number; height: number }) => void;
  fieldFor: (name: string) => FieldPresentation;
}) {
  const sourceName = useId();
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current++;
    },
    [],
  );
  async function selectFile(selected: File) {
    const attempt = ++selection.current;
    const validation = eventHeroImageFormSchema.shape.file.safeParse(selected);
    if (!validation.success) {
      toast(validation.error.issues[0].message, "error");
      return;
    }
    try {
      const cropped = await cropImage(selected, {
        width: EVENT_HERO_IMAGE_WIDTH,
        height: EVENT_HERO_IMAGE_HEIGHT,
        title: "Crop event header",
        confirmLabel: "Use crop",
      });
      if (cropped && attempt === selection.current)
        onFileChange(new File([cropped], "event-header.jpg", { type: "image/jpeg" }));
    } catch (error) {
      if (attempt === selection.current)
        toast(error instanceof Error ? error.message : "Could not crop the image.", "error");
    }
  }
  const [source, setSource] = useState<"upload" | "address">("upload");
  const [selectedPreview, setSelectedPreview] = useState<{ file: File; source: string } | null>(null);
  const preview = selectedPreview?.file === file ? selectedPreview.source : null;
  useEffect(() => {
    if (!file || !eventHeroImageFormSchema.shape.file.safeParse(file).success) {
      setSelectedPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setSelectedPreview({ file, source: reader.result });
    };
    reader.onerror = () => setSelectedPreview(null);
    reader.readAsDataURL(file);
    return () => {
      reader.onload = null;
      reader.onerror = null;
      reader.abort();
    };
  }, [file]);
  return (
    <Field
      group
      label="Hero image"
      {...(source === "upload" ? fieldFor("file") : {})}
      help={source === "upload" ? `${EVENT_HERO_IMAGE_GUIDANCE} Changes are saved with the event.` : undefined}
    >
      {(control) => (
        <div class="pk-stack">
          <div class="pk-cluster">
            <Radio
              name={sourceName}
              label="Upload image"
              value="upload"
              checked={source === "upload"}
              onChange={() => setSource("upload")}
            />
            <Radio
              name={sourceName}
              label="Use image address"
              value="address"
              checked={source === "address"}
              onChange={() => {
                selection.current++;
                onFileChange(null);
                setSource("address");
              }}
            />
          </div>
          {source === "upload" ? (
            <PictureTile
              control={control}
              inputName="file"
              name="this event"
              noun="hero image"
              shape="landscape"
              imageUrl={preview || image || null}
              alt="Event hero preview"
              canChange
              accept={IMAGE_UPLOAD_ALLOWED_MIME_TYPES.join(",")}
              selection={{
                onSelectFile: (selected) => {
                  void selectFile(selected);
                },
                onRemove: () => {
                  selection.current++;
                  onFileChange(null);
                  onImageChange("");
                },
              }}
              onImageLoad={(event) => {
                if (file && preview)
                  onDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              }}
              onImageError={() => {
                if (file) onDimensions({ width: 0, height: 0 });
              }}
            />
          ) : (
            <Field
              {...fieldFor("heroImageUrl")}
              label="Image address"
              help="Paste an existing image address, or leave it empty to remove the image."
            >
              {(addressControl) => (
                <TextInput
                  {...addressControl}
                  name="heroImageUrl"
                  value={image}
                  onInput={(event) => onImageChange(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
        </div>
      )}
    </Field>
  );
}
