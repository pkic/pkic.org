import { useState } from "preact/hooks";
import { markdownMediaInsertSchema } from "../../../shared/schemas/markdown-editor";
import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import type { z } from "zod";

type Media = z.output<typeof markdownMediaInsertSchema>;
export function EditorMediaFields({
  kind,
  onInsert,
  onCancel,
}: {
  kind: Media["kind"];
  onInsert: (media: Media) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const form = useContractForm(markdownMediaInsertSchema, { kind, url, description });
  return (
    <div class="pk-markdown-editor__media pk-stack" {...form.handlers} role="group" aria-label={`Insert ${kind}`}>
      <Field
        label={kind === "video" ? "Video URL" : kind === "image" ? "Image URL" : "Link URL"}
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
          label={kind === "image" ? "Image description" : "Link text"}
          required={kind === "image"}
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
          size="sm"
          variant="primary"
          onClick={() => {
            const result = form.submit();
            if (result.data) onInsert(result.data);
          }}
        >
          Insert {kind}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel insertion
        </Button>
      </div>
    </div>
  );
}
