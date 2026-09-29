import type { ComponentProps } from "preact";
import { useRef } from "preact/hooks";
import { Textarea } from "../../ui/TextControl";
import { highlightTemplateSyntax } from "../../shared/email-template-syntax";
import "../../ui/OverlayEditor.css";

/** A native source field with an escaped, decorative template-token backdrop. */
export function MarkdownSource({
  templateSyntax,
  ...props
}: ComponentProps<typeof Textarea> & { templateSyntax: boolean }) {
  const backdrop = useRef<HTMLPreElement>(null);
  if (!templateSyntax) return <Textarea {...props} />;
  return (
    <div class="pk-overlay-editor">
      <pre
        ref={backdrop}
        aria-hidden="true"
        class="pk-overlay-editor__backdrop pk-overlay-editor__backdrop--wrap"
        dangerouslySetInnerHTML={{ __html: `${highlightTemplateSyntax(String(props.value ?? ""))}\n` }}
      />
      <Textarea
        {...props}
        class="pk-mono pk-overlay-editor__input"
        onScroll={(event) => {
          if (backdrop.current) {
            backdrop.current.scrollTop = event.currentTarget.scrollTop;
            backdrop.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
      />
    </div>
  );
}
