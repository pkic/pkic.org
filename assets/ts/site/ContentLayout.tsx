import type { ComponentChildren } from "preact";
import { contentAttributeNames, type ContentContainer } from "../../shared/schemas/content-layout";
import { readMarkdownButton } from "../../shared/markdown-button";
import { contentButtonVariantSchema } from "../../shared/schemas/content-layout";
import { ButtonLink } from "../ui/Button";
import { ContentAside } from "./ContentAside";
import { ContentIcon } from "./ContentIcon";
import "./ContentLayout.css";

export function contentLayoutAttributes(block: Omit<ContentContainer, "markdown">) {
  return {
    class: `pk pk-content-${block.type}`,
    ...Object.fromEntries(contentAttributeNames.map((name) => [`data-${name}`, block[name]])),
  };
}
export function ContentLayout({
  block,
  children,
  html,
}: {
  block: ContentContainer;
  children?: ComponentChildren;
  html?: string;
}) {
  if (block.type === "button") {
    const link = readMarkdownButton(block.markdown);
    return (
      <ButtonLink
        href={link.href}
        title={link.title}
        class="pk-content-button"
        variant={contentButtonVariantSchema.parse(block.variant ?? "primary")}
      >
        {link.label}
      </ButtonLink>
    );
  }
  const inner = html === undefined ? { children } : { dangerouslySetInnerHTML: { __html: html } };
  if (block.type === "aside" && html === undefined) return <ContentAside>{children}</ContentAside>;
  const Tag = block.type === "aside" ? "aside" : "div";
  if (block.type === "columns")
    return (
      <div {...contentLayoutAttributes(block)}>
        <div class="pk-content-prose pk-content-columns__body" {...inner} />
      </div>
    );
  if (block.type === "card")
    return (
      <div {...contentLayoutAttributes(block)}>
        {block.icon && <ContentIcon name={block.icon} className="pk-content-card__icon" />}
        <div class="pk-content-card__content" {...inner} />
      </div>
    );
  return <Tag {...contentLayoutAttributes(block)} {...inner} />;
}
