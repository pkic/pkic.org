import type { Editor } from "@tiptap/core";
import type { MenuItem } from "../../ui/Menu";

const languages = [
  ["", "Plain text"],
  ["bash", "Shell"],
  ["c", "C"],
  ["cpp", "C++"],
  ["css", "CSS"],
  ["go", "Go"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["markdown", "Markdown"],
  ["mermaid", "Mermaid diagram"],
  ["python", "Python"],
  ["rust", "Rust"],
  ["sql", "SQL"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
  ["yaml", "YAML"],
] as const;

/** The menu offers common fence languages while preserving other authored language identifiers. */
export function codeLanguageItems(editor: Editor | null, disabled = false): MenuItem[] {
  const current = String(editor?.getAttributes("codeBlock").language ?? "");
  const choices: readonly (readonly [string, string])[] = languages.some(([value]) => value === current)
    ? languages
    : [[current, current], ...languages];
  return choices.map(([language, label]) => ({
    id: language ? `code-language-${language}` : "code-plain",
    label,
    checked: Boolean(editor?.isActive("codeBlock")) && current === language,
    disabled,
    onSelect: () => editor?.chain().focus().setCodeBlock({ language }).run(),
  }));
}

export function codeLanguageLabel(language: string) {
  return languages.find(([value]) => value === language)?.[1] ?? language;
}

export function codeBlockActions(editor: Editor): MenuItem[] {
  if (!editor.isActive("codeBlock")) return [];
  return [
    {
      id: "code-language",
      label: `Code language: ${codeLanguageLabel(String(editor.getAttributes("codeBlock").language ?? ""))}`,
      children: codeLanguageItems(editor),
    },
    {
      id: "code-paragraph",
      label: "Convert to paragraph",
      onSelect: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
}
