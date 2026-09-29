/**
 * The one place that says what `{{< … >}}` means in stored Markdown.
 *
 * Member pages used to be Hugo pages, so a member who wanted a video wrote a
 * Hugo shortcode: `{{< youtube HGoZW7MCF60 >}}`. The pages are rows in D1 now
 * and the field is Markdown, which knows nothing about that syntax — so the
 * braces were printed verbatim on the public page (issue #12). That is the
 * failure worth naming: a renderer that implements part of a syntax and emits
 * the rest as literal text tells the reader nothing and tells the author
 * nothing either. The same shape put `{{#startDate}}` on an email.
 *
 * So the contract is stated once, here, and every side reads it from here:
 *
 *   - A **supported** shortcode resolves to the URL it always meant. The
 *     Markdown renderer already turns a video URL on a line of its own into a
 *     responsive embed, so resolving to a URL is the whole implementation —
 *     there is no second embed path to keep in step.
 *   - An **unsupported** one is removed rather than printed. A reader must
 *     never be shown template syntax, and the author is told at the point of
 *     writing instead: `markdownContentSchema` refuses it, naming what is
 *     supported, so the shared contract is what teaches the rule.
 *
 * The supported set is deliberately small — it is exactly the set the member
 * corpus uses, and `tests/tools/markdown-shortcode-corpus.test.ts` fails if
 * `data/members/*.yaml` ever grows one this list does not cover.
 *
 * Plain-Node-loadable (explicit `.ts` import specifiers, no bundler features)
 * because `scripts/migrate-members/parsers.mjs` imports it: the importer and
 * the runtime must not hold two different opinions about the same braces.
 */

/** Shortcode names stored Markdown may carry, and what each one embeds. */
export const SUPPORTED_MARKDOWN_SHORTCODES = ["youtube", "vimeo", "video"] as const;

export type MarkdownShortcodeName = (typeof SUPPORTED_MARKDOWN_SHORTCODES)[number];

export interface MarkdownShortcode {
  /** The shortcode name as written, lower-cased. */
  name: string;
  /** Everything between the name and the closing delimiter, trimmed. */
  argument: string;
  /** The full `{{< … >}}` text, so a caller can replace exactly what it matched. */
  raw: string;
}

/**
 * Both Hugo delimiter pairs (`{{< >}}` and `{{% %}}`), with or without the
 * spaces people leave out — `{{< youtube csGJEyVen-o>}}` is real member
 * content. The name is captured separately from its argument so an unknown
 * name can be reported by name rather than as a wall of braces.
 */
const SHORTCODE_PATTERN = /\{\{[<%]\s*([A-Za-z][\w-]*)((?:(?![>%]\}\})[\s\S])*)[>%]\}\}/g;

function isSupported(name: string): name is MarkdownShortcodeName {
  return (SUPPORTED_MARKDOWN_SHORTCODES as readonly string[]).includes(name);
}

/** Every shortcode in `text`, in source order, supported or not. */
export function findMarkdownShortcodes(text: string): MarkdownShortcode[] {
  const found: MarkdownShortcode[] = [];
  // A fresh expression per call: a module-level global regex carries
  // `lastIndex` between calls and would skip matches on the second one.
  const pattern = new RegExp(SHORTCODE_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    found.push({ name: match[1].toLowerCase(), argument: match[2].trim(), raw: match[0] });
  }
  return found;
}

/** The distinct unsupported shortcode names in `text`, in source order. */
export function unsupportedMarkdownShortcodeNames(text: string): string[] {
  const names: string[] = [];
  for (const shortcode of findMarkdownShortcodes(text)) {
    if (!isSupported(shortcode.name) && !names.includes(shortcode.name)) names.push(shortcode.name);
  }
  return names;
}

/**
 * The URL a supported shortcode stands for, or null when it carries no usable
 * argument. `video` took named attributes in Hugo; only `link` ever named a
 * destination, so that is the one read.
 */
export function markdownShortcodeUrl(shortcode: MarkdownShortcode): string | null {
  switch (shortcode.name) {
    case "youtube": {
      const id = /^[\w-]+$/.exec(shortcode.argument);
      return id ? `https://www.youtube.com/watch?v=${id[0]}` : null;
    }
    case "vimeo": {
      const id = /^\d+$/.exec(shortcode.argument);
      return id ? `https://vimeo.com/${id[0]}` : null;
    }
    case "video": {
      const link = /link\s*=\s*"([^"]+)"/.exec(shortcode.argument);
      return link ? link[1] : null;
    }
    default:
      return null;
  }
}

/**
 * `text` with every shortcode resolved: a supported one becomes the URL it
 * meant, anything else disappears.
 *
 * Called on the way in by the member importer and on the way out by the
 * Markdown renderer, so a row written before this existed renders the same as
 * one written after it.
 */
export function resolveMarkdownShortcodes(text: string): string {
  const pattern = new RegExp(SHORTCODE_PATTERN.source, "g");
  return text.replace(pattern, (raw, name: string, argument: string) => {
    const shortcode: MarkdownShortcode = { name: name.toLowerCase(), argument: argument.trim(), raw };
    return markdownShortcodeUrl(shortcode) ?? "";
  });
}

/** What the contract and the editors tell an author, from the one list. */
export function supportedMarkdownShortcodeList(): string {
  return SUPPORTED_MARKDOWN_SHORTCODES.join(", ");
}
