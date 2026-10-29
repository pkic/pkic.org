import { useState } from "preact/hooks";
import { markdownMediaInsertSchema, type MarkdownMediaInsert } from "../../../shared/schemas/markdown-editor";
import { useContractForm } from "../../hooks/useContractForm";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

type Media = MarkdownMediaInsert;
export function EditorMediaFields({
  kind,
  onInsert,
  onCancel,
  initialValue,
}: {
  kind: Media["kind"];
  initialValue?: { url: string; description: string };
  onInsert: (media: Media) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initialValue?.url ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const form = useContractForm(markdownMediaInsertSchema, { kind, url, description });
  return (
    <Dialog
      open
      title={`${initialValue ? "Edit" : "Insert"} ${kind}`}
      confirmLabel={`${initialValue ? "Update" : "Insert"} ${kind}`}
      closeLabel="Close content editor"
      onConfirm={() => {
        const result = form.submit();
        if (result.data) onInsert(result.data);
      }}
      onCancel={onCancel}
    >
      <div class="pk-stack" {...form.handlers}>
        <Field
          label={
            kind === "video"
              ? "Video URL"
              : kind === "image"
                ? "Image URL"
                : kind === "button"
                  ? "Button destination"
                  : "Link URL"
          }
          required
          {...form.of("url")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="url"
              value={url}
              placeholder="https://"
              onInput={(e) => setUrl(e.currentTarget.value)}
            />
          )}
        </Field>
        {kind !== "video" && (
          <Field
            label={kind === "image" ? "Image description" : kind === "button" ? "Button text" : "Link text"}
            required={kind === "image" || kind === "button"}
            {...form.of("description")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="description"
                value={description}
                onInput={(e) => setDescription(e.currentTarget.value)}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
