import type { ComponentChildren } from "preact";
import { Marked, type Token, type Tokens } from "marked";
import { resolveMarkdownShortcodes } from "../../shared/markdown-shortcodes";
import { markdownSafeUrl, markdownVideoEmbed } from "../../shared/markdown-media";
import "../ui/Content.css";
import "./markdown-editor/markdown-content.scss";

// Keep editor-specific tokenizer registrations out of the public renderer.
const parser = new Marked();

/** Render tokens as elements, never as HTML from the author. */
function renderTokens(tokens: Token[]): ComponentChildren {
  return tokens.map((token, index) => {
    const children = "tokens" in token && token.tokens ? renderTokens(token.tokens) : "text" in token ? token.text : "";
    switch (token.type) {
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
          <a
            key={index}
            href={token.href}
            title={token.title ?? undefined}
            target={/^https?:/i.test(token.href) ? "_blank" : undefined}
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ) : (
          children
        );
      case "image":
        return markdownSafeUrl(token.href, true) ? (
          <img key={index} src={token.href} alt={token.text} title={token.title ?? undefined} loading="lazy" />
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
          <div key={index} class="pk-markdown__table">
            <table>
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
      default:
        return children;
    }
  });
}

export function Markdown({ markdown = "", className }: { markdown?: string | null; className?: string }) {
  return (
    <div class={["pk-markdown", className].filter(Boolean).join(" ")}>
      {renderTokens(parser.lexer(resolveMarkdownShortcodes(markdown ?? "")))}
    </div>
  );
}
