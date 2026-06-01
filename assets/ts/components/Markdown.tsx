import { Fragment, type ComponentChildren } from "preact";

type ListBlock = { type: "ul" | "ol"; items: string[] };
type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; text: string }
  | ListBlock;

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|\/(?!\/)|#)/i.test(href);
}

function renderInline(text: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = [];
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));

    if (match[2]) {
      nodes.push(<code>{match[2]}</code>);
    } else if (match[4]) {
      nodes.push(<strong>{renderInline(match[4])}</strong>);
    } else if (match[6]) {
      nodes.push(<em>{renderInline(match[6])}</em>);
    } else if (match[8] && match[9]) {
      const href = match[9];
      nodes.push(
        isSafeHref(href) ? (
          <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
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
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

export function Markdown({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = parseMarkdown(markdown);

  return (
    <div class={`adm-markdown${className ? ` ${className}` : ""}`}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Heading = `h${block.level}` as "h2" | "h3" | "h4";
            return <Heading key={index}>{renderInline(block.text)}</Heading>;
          }
          case "blockquote":
            return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
          case "code":
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
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
