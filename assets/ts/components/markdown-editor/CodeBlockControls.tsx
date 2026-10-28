import type { Editor } from "@tiptap/core";
import { Menu } from "../../ui/Menu";
import { buttonClasses } from "../../ui/button-classes";
import { codeLanguageItems, codeLanguageLabel } from "./code-language-menu";
import { Button } from "../../ui/Button";

export function CodeBlockControls({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const language = String(editor.getAttributes("codeBlock").language ?? "");
  const label = codeLanguageLabel(language);
  return (
    <div class="pk-markdown-editor__toolbar" data-density="compact" role="group" aria-label="Code block editing">
      <Menu
        label={`Code language: ${label}`}
        items={codeLanguageItems(editor, disabled)}
        variant="plain"
        triggerClass={buttonClasses({ variant: "ghost" }, undefined)}
      >
        Language: {label}
      </Menu>
      <Button variant="ghost" disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        Convert to paragraph
      </Button>
    </div>
  );
}
