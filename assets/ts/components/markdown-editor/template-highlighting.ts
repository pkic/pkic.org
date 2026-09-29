import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { templateSyntaxSpans } from "../../shared/email-template-syntax";

/** Decorations preserve literal template syntax without changing the saved document. */
export const TemplateHighlighting = Extension.create({
  name: "templateHighlighting",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const positions: number[] = [];
            let source = "";
            state.doc.descendants((node, position) => {
              if (node.isText && node.text) {
                for (let index = 0; index < node.text.length; index++) positions.push(position + index);
                source += node.text;
              } else if (node.isBlock && source.length) {
                source += "\n";
                positions.push(position);
              }
            });
            return DecorationSet.create(
              state.doc,
              templateSyntaxSpans(source).map((span) =>
                Decoration.inline(positions[span.from], positions[span.to - 1] + 1, {
                  class: `adm-template-token ${span.className}`,
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
