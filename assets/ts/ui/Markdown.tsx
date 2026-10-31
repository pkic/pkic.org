import { ContentProse } from "../site/ContentProse";
import "./Table.css";
import { ContentLayout } from "../site/ContentLayout";
import { contentContainerNames, type ContentContainer } from "../../shared/schemas/content-layout";
import { CONTAINER_START, tryReadMarkdownContainer } from "../../shared/markdown-aside";
import { SiteImage } from "../site/SiteImage";
import type { ComponentChildren } from "preact";
import { Marked, type Token, type Tokens } from "marked";
import { resolveMarkdownShortcodes } from "../../shared/markdown-shortcodes";
import { markdownSafeUrl, markdownVideoEmbed } from "../../shared/markdown-media";
import { liveChatSafeLink } from "../../shared/live-chat-policy";
import { NEW_TAB_ATTRIBUTES, NEW_TAB_HINT, isExternalHref } from "./new-tab";
import { decodeCharacterReferences } from "../../shared/html-entities";
import "../ui/Content.css";
import "../components/markdown-editor/markdown-content.scss";

// Keep editor-specific tokenizer registrations out of the public renderer.
const parser = new Marked({
  extensions: contentContainerNames.map((name) => ({
    name,
    level: "block",
    start(source) {
      return source.search(CONTAINER_START);
    },
    tokenizer(source) {
      const aside = tryReadMarkdownContainer(source);
      return aside?.block.type === name
        ? { type: name, block: aside.block, raw: aside.raw, tokens: this.lexer.blockTokens(aside.block.markdown) }
        : undefined;
    },
  })),
});

/**
 * The one anchor every rendered Markdown link goes through: a destination
 * outside the portal opens in a new tab and says so to screen readers.
 * `untrusted` (chat) also tells search engines not to follow it.
 */
function MarkdownLink({
  href,
  title,
  untrusted = false,
  children,
}: {
  href: string;
  title?: string;
  untrusted?: boolean;
  children?: ComponentChildren;
}) {
  const rel = untrusted ? "noopener nofollow ugc noreferrer" : NEW_TAB_ATTRIBUTES.rel;
  if (!isExternalHref(href)) {
    return (
      <a href={href} title={title} rel={untrusted ? rel : undefined}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} title={title} target={NEW_TAB_ATTRIBUTES.target} rel={rel}>
      {children}
      <span class="pk-sr-only"> {NEW_TAB_HINT}</span>
    </a>
  );
}

/** Render tokens as elements, never as HTML from the author. */
function renderTokens(tokens: Token[]): ComponentChildren {
  return tokens.map((token, index) => {
    const children = "tokens" in token && token.tokens ? renderTokens(token.tokens) : "text" in token ? token.text : "";
    switch (token.type) {
      case "aside":
      case "columns":
      case "grid":
      case "item":
      case "cards":
      case "card":
      case "actions":
      case "button":
      case "card-header":
      case "card-footer":
        return (
          <ContentLayout key={index} block={(token as Token & { block: ContentContainer }).block}>
            {children}
          </ContentLayout>
        );
      case "space":
        return null;
      case "paragraph": {
        const embed = markdownVideoEmbed(token.text);
        return embed ? (
          <iframe
            key={index}
            class="pk-framed pk-embed"
            src={embed}
            title="Embedded video"
            loading="lazy"
            allow="autoplay; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <p key={index}>{children}</p>
        );
      }
      case "heading": {
        const Heading = `h${Math.max(2, Math.min(6, token.depth))}` as "h2" | "h3" | "h4" | "h5" | "h6";
        return <Heading key={index}>{children}</Heading>;
      }
      case "strong":
        return <strong key={index}>{children}</strong>;
      case "em":
        return <em key={index}>{children}</em>;
      case "del":
        return <s key={index}>{children}</s>;
      case "codespan":
        return <code key={index}>{token.text}</code>;
      case "code":
        return (
          <pre key={index} class="pk-code-block pk-answer-pre">
            <code>{token.text}</code>
          </pre>
        );
      case "blockquote":
        return <blockquote key={index}>{children}</blockquote>;
      case "br":
        return <br key={index} />;
      case "hr":
        return <hr key={index} />;
      case "link":
        return markdownSafeUrl(token.href) ? (
          <MarkdownLink key={index} href={token.href} title={token.title ?? undefined}>
            {children}
          </MarkdownLink>
        ) : (
          children
        );
      case "image":
        return markdownSafeUrl(token.href, true) ? (
          <SiteImage key={index} src={token.href} alt={token.text} title={token.title ?? undefined} loading="lazy" />
        ) : (
          token.text
        );
      case "list": {
        const List = token.ordered ? "ol" : "ul";
        return (
          <List key={index} start={token.ordered ? token.start || 1 : undefined}>
            {(token as Tokens.List).items.map((item, i) => (
              <li key={i}>{renderTokens(item.tokens)}</li>
            ))}
          </List>
        );
      }
      case "table":
        return (
          <div key={index} class="pk-table__scroll pk-table__scroll--prose">
            <table class="pk-table">
              <thead>
                <tr>
                  {(token as Tokens.Table).header.map((cell, i) => (
                    <th key={i}>{renderTokens(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(token as Tokens.Table).rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{renderTokens(cell.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      // Raw HTML remains visible text. It is never interpreted or inserted.
      case "html":
        return token.text;
      // The editor writes a typed `&` as `&amp;`; read it as the character it stands for.
      case "text":
        return "tokens" in token && token.tokens ? children : decodeCharacterReferences(token.text);
      default:
        return children;
    }
  });
}

/** Chat is written by any participant, so a single line break counts and only inline marks are read. */
const chatParser = new Marked({ gfm: true, breaks: true });

/**
 * The chat profile: bold, italic, inline code, links and line breaks, and
 * nothing else. Every other construct (headings, lists, images, HTML) is
 * shown as the characters the author typed. A link is followed only to an
 * absolute web or mail address, and never passes the reader's standing on.
 */
function renderChatTokens(tokens: Token[]): ComponentChildren {
  return tokens.map((token, index) => {
    const children = "tokens" in token && token.tokens ? renderChatTokens(token.tokens) : null;
    switch (token.type) {
      case "space":
        return null;
      case "paragraph":
        return <p key={index}>{children}</p>;
      case "text":
        return children ?? token.text;
      case "escape":
        return token.text;
      case "strong":
        return <strong key={index}>{children}</strong>;
      case "em":
        return <em key={index}>{children}</em>;
      case "codespan":
        return <code key={index}>{token.text}</code>;
      case "br":
        return <br key={index} />;
      case "link": {
        const href = liveChatSafeLink(token.href);
        return href ? (
          <MarkdownLink key={index} href={href} untrusted>
            {children}
          </MarkdownLink>
        ) : (
          token.raw
        );
      }
      default:
        // Blocks outside the profile keep their own lines as typed text.
        return token.type === "heading" ||
          token.type === "list" ||
          token.type === "code" ||
          token.type === "blockquote" ||
          token.type === "hr" ||
          token.type === "table" ||
          token.type === "html" ? (
          <p key={index}>{token.raw.replace(/\n+$/u, "")}</p>
        ) : (
          token.raw
        );
    }
  });
}

export function Markdown({
  markdown = "",
  className,
  profile = "content",
  layout = "compact",
}: {
  markdown?: string | null;
  className?: string;
  /** `chat` reads the inline subset participants may use in a live chat. */
  profile?: "content" | "chat";
  /** Reading typography for a complete page; compact content keeps its application's scale. */
  layout?: "compact" | "reading";
}) {
  const children =
    profile === "chat"
      ? renderChatTokens(chatParser.lexer(markdown ?? ""))
      : renderTokens(parser.lexer(resolveMarkdownShortcodes(markdown ?? "")));
  const classes = ["pk-markdown", className].filter(Boolean).join(" ");
  if (profile === "content" && layout === "reading") return <ContentProse class={classes}>{children}</ContentProse>;
  return <div class={classes}>{children}</div>;
}
