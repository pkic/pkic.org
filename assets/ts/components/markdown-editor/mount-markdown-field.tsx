import { render } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { z } from "zod";
import { useContractForm } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import type { MarkdownEditor as EditorComponent } from "./MarkdownEditor";

interface MarkdownFieldValidation {
  validate(): boolean;
}

/** Bridges server-rendered forms to the shared editor and their canonical field contract. */
export async function mountMarkdownField(
  field: HTMLTextAreaElement | null,
  label: string,
  fieldSchema: z.ZodType,
): Promise<MarkdownFieldValidation | undefined> {
  if (!field) return;
  const { MarkdownEditor } = await import("./MarkdownEditor");
  if (!field.isConnected) return;
  const wrapper = field.closest(".pk-field");
  const help = wrapper?.querySelector(".pk-field__help")?.textContent?.trim();
  const errorSlot = wrapper?.querySelector<HTMLElement>("[data-field-error]")?.dataset.fieldError ?? field.name;
  const container = document.createElement("div");
  const controller: MarkdownFieldValidation = { validate: () => false };
  const schema = z.object({ [field.name]: fieldSchema });
  (wrapper ?? field).replaceWith(container);
  render(
    <MountedMarkdownField
      field={field}
      label={label}
      help={help}
      errorSlot={errorSlot}
      schema={schema}
      controller={controller}
      Editor={MarkdownEditor}
    />,
    container,
  );
  return controller;
}

function MountedMarkdownField({
  field,
  label,
  help,
  errorSlot,
  schema,
  controller,
  Editor,
}: {
  field: HTMLTextAreaElement;
  label: string;
  help?: string;
  errorSlot: string;
  schema: z.ZodObject<Record<string, z.ZodType>>;
  controller: MarkdownFieldValidation;
  Editor: typeof EditorComponent;
}) {
  const [value, setValue] = useState(field.value);
  const contract = useContractForm(schema, { [field.name]: value });
  useLayoutEffect(() => {
    controller.validate = () => contract.submit().data !== null;
  });
  return (
    <div {...contract.handlers}>
      <Field
        id={field.id}
        label={label}
        help={help}
        errorSlot={errorSlot}
        required={field.required}
        {...contract.of(field.name)}
      >
        {(control) => (
          <Editor
            {...control}
            name={field.name}
            label={label}
            initialValue={field.value}
            disabled={field.disabled}
            onChange={setValue}
          />
        )}
      </Field>
    </div>
  );
}
