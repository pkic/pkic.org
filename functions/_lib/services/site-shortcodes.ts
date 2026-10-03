import { parse as parseYaml } from "yaml";

/**
 * The shortcode syntax the content is authored in.
 *
 * Hugo's `{{< name … >}}` and the Markdown directive form `:::name` say the
 * same thing, so the directives are normalised into shortcodes first and only
 * one grammar has to be parsed after that.
 */
export interface ContentCall {
  inner?: string;
  positional: string[];
  props: Record<string, string>;
}

export const BLOCK_DIRECTIVE = /^:::(\w[\w-]*)(?:\{([^}]*)\})?\s*\n([\s\S]*?)^:::\s*$/gm;
export const LEAF_DIRECTIVE = /^::(\w[\w-]*)(?:\{([^}]*)\})?\s*$/gm;
export const SHORTCODE_BLOCK = /{{[<%]\s*([a-zA-Z0-9_-]+)\b([^}]*)[>%]}}([\s\S]*?){{[<%]\s*\/\1\s*[>%]}}/;
export const SHORTCODE_LEAF = /{{[<%]\s*([a-zA-Z0-9_-]+)\b([^}]*)[>%]}}/;

function attributesSource(value: string): string {
  return value.trim().replace(/^(.*)$/, (_match, attributes: string) => attributes.replace(/\s+/g, " "));
}

export function normalizeDirectives(markdown: string): string {
  let value = markdown;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = value.replace(
      BLOCK_DIRECTIVE,
      (_whole, name: string, attributes: string | undefined, inner: string) =>
        `{{< ${name} ${attributesSource(attributes ?? "")} >}}\n${inner}\n{{< /${name} >}}`,
    );
    if (next === value) break;
    value = next;
  }
  return value.replace(
    LEAF_DIRECTIVE,
    (_whole, name: string, attributes: string | undefined) => `{{< ${name} ${attributesSource(attributes ?? "")} >}}`,
  );
}

export function parseArguments(source: string): Pick<ContentCall, "positional" | "props"> {
  const props: Record<string, string> = {};
  const positional: string[] = [];
  const tokens = source.match(/[^\s=]+=(?:"[^"]*"|'[^']*'|[^\s]+)|"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  for (const token of tokens) {
    const equals = token.indexOf("=");
    if (equals > 0) {
      props[token.slice(0, equals)] = unquote(token.slice(equals + 1));
    } else {
      positional.push(unquote(token));
    }
  }
  return { positional, props };
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

export function objectValue(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed: unknown = parseYaml(value);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
