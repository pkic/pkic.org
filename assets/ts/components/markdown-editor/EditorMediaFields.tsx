import { useState } from "preact/hooks";
import { markdownMediaInsertSchema, type MarkdownMediaInsert } from "../../../shared/schemas/markdown-editor";
import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
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
    <div
      class="pk-markdown-editor__media pk-stack"
      {...form.handlers}
      role="group"
      aria-label={`${initialValue ? "Edit" : "Insert"} ${kind}`}
    >
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
      <div class="pk-cluster">
        <Button
          variant="primary"
          onClick={() => {
            const result = form.submit();
            if (result.data) onInsert(result.data);
          }}
        >
          {initialValue ? "Update" : "Insert"} {kind}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel {initialValue ? "editing" : "insertion"}
        </Button>
      </div>
    </div>
  );
}
