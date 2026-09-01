import { Fragment, type ComponentChildren } from "preact";

// `pk-code-block`, `pk-answer-pre`, `pk-framed` and `pk-embed` are Content.css
// classes, and component CSS ships in a lazy chunk rather than the entry
// stylesheet — a module that writes those class names has to import the sheet
// that defines them, or the markup renders unstyled.
import "../ui/Content.css";

type ListBlock = { type: "ul" | "ol"; items: string[] };
type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; text: string }
  | { type: "video"; embedUrl: string }
  | ListBlock;

// scripts/migrate-members-yaml-to-d1.mjs rewrites legacy Hugo shortcodes
// (`{{< youtube ID >}}` etc.) into bare URLs before they land in
// organizations.content_markdown — this renderer never saw an embed until
// now, it just linkified (or, before that, left inert) the plain URL. A
// paragraph consisting of nothing but one of these three URL shapes (bare,
// or a `[text](url)` link — both forms show up in migrated content) renders
// as a responsive iframe embed instead.
function extractVideoEmbedUrl(paragraphText: string): string | null {
  const linkMatch = /^\[[^\]]*\]\((\S+)\)$/.exec(paragraphText.trim());
  const url = linkMatch ? linkMatch[1] : paragraphText.trim();

  const youtubeWatch = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/i.exec(url);
  if (youtubeWatch) return `https://www.youtube.com/embed/${youtubeWatch[1]}`;

  const youtubeShort = /^https?:\/\/youtu\.be\/([\w-]+)/i.exec(url);
  if (youtubeShort) return `https://www.youtube.com/embed/${youtubeShort[1]}`;

  const vimeo = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  return null;
}

function isSafeHref(href: string): boolean {
  if (/^[a-z0-9+.-]+:/i.test(href)) {
    return /^(https?:|mailto:|tel:)/i.test(href);
  }
  return !href.startsWith("//");
}

function renderInline(text: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = [];
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${match.index}-${pattern.lastIndex}`;

    if (match[2]) {
      nodes.push(<code key={key}>{match[2]}</code>);
    } else if (match[4]) {
      nodes.push(<strong key={key}>{renderInline(match[4])}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={key}>{renderInline(match[6])}</em>);
    } else if (match[8] && match[9]) {
      const href = match[9];
      nodes.push(
        isSafeHref(href) ? (
          <a href={href} target={/^https?:/i.test(href) ? "_blank" : undefined} rel="noopener noreferrer" key={key}>
            {renderInline(match[8])}
          </a>
        ) : (
          match[8]
        ),
      );
    }

    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: Math.max(2, heading[1].length) as 2 | 3 | 4, text: heading[2] });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: quote.join("\n") });
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const type: ListBlock["type"] = unordered ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const item = type === "ul" ? /^\s*[-*]\s+(.+)$/.exec(lines[i]) : /^\s*\d+[.)]\s+(.+)$/.exec(lines[i]);
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      blocks.push({ type, items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    const paragraphText = paragraph.join(" ");
    const embedUrl = extractVideoEmbedUrl(paragraphText);
    blocks.push(embedUrl ? { type: "video", embedUrl } : { type: "paragraph", text: paragraphText });
  }

  return blocks;
}

export function Markdown({ markdown = "", className }: { markdown?: string | null; className?: string }) {
  const blocks = parseMarkdown(markdown ?? "");

  return (
    // No `.pk` of its own: rendered Markdown is a block inside somebody else's
    // surface — a review card, a decision panel, a member page — and it should
    // read as that surface's prose. Where the surface has adopted the system,
    // the base layer already gives these bare elements their type, rhythm and
    // link colour; where it has not, they fall back to the page's own.
    <div class={className}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Heading = `h${block.level}` as "h2" | "h3" | "h4";
            return <Heading key={index}>{renderInline(block.text)}</Heading>;
          }
          case "blockquote":
            // The quote recedes rather than carrying a rule of its own: there
            // is no quote treatment in the system to reach for, and inventing
            // a colour or a border width here is how a system stops being one.
            return (
              <blockquote class="pk-muted" key={index}>
                {renderInline(block.text)}
              </blockquote>
            );
          case "code":
            return (
              <pre class="pk-code-block pk-answer-pre" key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case "video":
            return (
              <iframe
                key={index}
                class="pk-framed pk-embed"
                src={block.embedUrl}
                title="Embedded video"
                loading="lazy"
                allow="autoplay; picture-in-picture; fullscreen"
                allowFullScreen
              ></iframe>
            );
          case "ul":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={index}>{renderInline(block.text)}</p>;
        }
      })}
      {blocks.length === 0 && <Fragment />}
    </div>
  );
}
