import { useState } from "preact/hooks";
import type { PreviewSection } from "./PreviewShell";
import { EventHeroImageField } from "../../member-flows/portal/sections/events/detail/settings/EventHeroImageField";
import { useContractForm } from "../../hooks/useContractForm";
import { eventHeroImageFormSchema } from "../../../shared/schemas/event-hero-image";

function PictureUploadSpecimen() {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const form = useContractForm(eventHeroImageFormSchema, {
    expectedUpdatedAt: "2026-11-04T00:00:00.000Z",
    file,
    dimensions,
  });
  return (
    <div class="pk-stack" {...form.handlers}>
      <EventHeroImageField
        file={file}
        image={image}
        onFileChange={(next) => {
          setFile(next);
          setDimensions(null);
        }}
        onImageChange={setImage}
        onDimensions={setDimensions}
        fieldFor={form.of}
      />
    </div>
  );
}

export const pictureUploadSection: PreviewSection = {
  id: "picture-upload",
  title: "Picture uploads",
  note: "Click the picture to choose a replacement. Event artwork is selected as a draft and saved with its form.",
  render: () => <PictureUploadSpecimen />,
};
