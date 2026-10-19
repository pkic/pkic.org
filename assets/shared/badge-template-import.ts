import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { eventBadgeTemplateSchema, type EventBadgeTemplate } from "./schemas/event-badge-template";
import { BADGE_PRINT_CONTENT_SECURITY_POLICY } from "./badge-template-render";

const descriptorSchema = z
  .object({
    version: eventBadgeTemplateSchema.shape.version,
    name: eventBadgeTemplateSchema.shape.name,
    widthMm: eventBadgeTemplateSchema.shape.widthMm,
    heightMm: eventBadgeTemplateSchema.shape.heightMm,
    sponsorGroups: eventBadgeTemplateSchema.shape.sponsorGroups,
  })
  .strict();
type HtmlNode = Record<string, unknown>;
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
function dataUrl(asset: EventBadgeTemplate["assets"][string]): string {
  return `data:${asset.mime};base64,${asset.base64}`;
}

/** Plain, editable HTML authoring transport. It never contains a credential or attendee population. */
export function exportBadgeTemplateHtml(input: EventBadgeTemplate): string {
  const template = eventBadgeTemplateSchema.parse(input);
  const { version, name, widthMm, heightMm, sponsorGroups } = template;
  const replace = (source: string) =>
    source.replace(/asset:([a-z][a-z0-9_-]{0,63})/g, (_, key: string) => {
      const asset = template.assets[key];
      if (!asset) throw new Error("Unknown template asset.");
      return dataUrl(asset);
    });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta http-equiv="Content-Security-Policy" content="${escape(BADGE_PRINT_CONTENT_SECURITY_POLICY)}"/><meta name="referrer" content="no-referrer"/><meta name="badge-template" content="${escape(JSON.stringify({ version, name, widthMm, heightMm, sponsorGroups }))}"/><title>${escape(name)}</title><style>${replace(template.css).replace(/&/g, "&amp;")}</style></head><body><section data-badge-side="front">${replace(template.frontHtml)}</section><section data-badge-side="back">${replace(template.backHtml)}</section></body></html>`;
}

/** Parse data only, without DOM insertion, browser requests, JavaScript, or evaluation of bundle code. */
export function importBadgeTemplateHtml(input: string): EventBadgeTemplate {
  if (new TextEncoder().encode(input).byteLength > 2 * 1024 * 1024)
    throw new Error("The HTML template must fit within 2 MiB.");
  const source = input.replace(/^\s*<!doctype\s+html\s*>/i, "");
  if (/<!|<\?/.test(source)) throw new Error("HTML declarations, entities, and bundle code are not supported.");
  const parsed: unknown = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    // Decode standard HTML/numeric text entities; DTDs and custom entities remain refused above.
    htmlEntities: true,
    unpairedTags: ["img", "br", "meta"],
  }).parse(source, { unpairedTags: ["img", "br", "meta"] });
  if (!Array.isArray(parsed)) throw new Error("Invalid HTML template.");
  const assets: EventBadgeTemplate["assets"] = {};
  const dedup = new Map<string, string>();
  function assetFromUrl(url: string): string {
    const previous = dedup.get(url);
    if (previous) return previous;
    const match = /^data:(image\/svg\+xml|font\/woff2|font\/ttf);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match) throw new Error("HTML assets must be inline SVG, WOFF2, or TrueType data, without external URLs.");
    const key = `imported_asset_${dedup.size}`;
    assets[key] = { mime: match[1] as EventBadgeTemplate["assets"][string]["mime"], base64: match[2] };
    dedup.set(url, `asset:${key}`);
    return `asset:${key}`;
  }
  function entries(value: unknown): HtmlNode[] {
    if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)))
      throw new Error("Invalid HTML nodes.");
    return value as HtmlNode[];
  }
  function tag(node: HtmlNode): string {
    return Object.keys(node).find((key) => key !== ":@") ?? "";
  }
  function attrs(node: HtmlNode): Record<string, string> {
    const value = node[":@"] ?? {};
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((item) => typeof item !== "string")
    )
      throw new Error("Invalid HTML attributes.");
    return value as Record<string, string>;
  }
  function text(value: unknown): string {
    return entries(value)
      .map((node) => {
        if (tag(node) !== "#text" || typeof node["#text"] !== "string") throw new Error("Expected inert text content.");
        return node["#text"];
      })
      .join("");
  }
  function serialize(value: unknown, depth = 0): string {
    if (depth > 32) throw new Error("HTML is nested too deeply.");
    return entries(value)
      .map((node) => {
        const name = tag(node);
        if (name === "#text") return escape(String(node["#text"]));
        if (name === "svg") {
          const url = `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(serializeSvg(node)), (byte) => String.fromCharCode(byte)).join(""))}`;
          return `<img src="${assetFromUrl(url)}" alt=""/>`;
        }
        const attributes = Object.entries(attrs(node))
          .map(([key, value]) => ` ${key}="${escape(name === "img" && key === "src" ? assetFromUrl(value) : value)}"`)
          .join("");
        return `<${name}${attributes}>${serialize(node[name], depth + 1)}</${name}>`.replace(
          /^<(img|br)([^>]*)><\/\1>$/,
          "<$1$2/>",
        );
      })
      .join("");
  }
  function serializeSvg(node: HtmlNode): string {
    function content(value: unknown, depth: number): string {
      if (depth > 32) throw new Error("Vector markup is nested too deeply.");
      return entries(value)
        .map((item) => {
          const name = tag(item);
          if (name === "#text") return escape(String(item["#text"]));
          const attributes = Object.entries(attrs(item))
            .map(([key, value]) => ` ${key}="${escape(value)}"`)
            .join("");
          return `<${name}${attributes}>${content(item[name], depth + 1)}</${name}>`;
        })
        .join("");
    }
    return content([node], 0);
  }
  const roots = entries(parsed).filter((node) => tag(node) !== "#text" || String(node["#text"]).trim());
  if (roots.length !== 1 || tag(roots[0]) !== "html") throw new Error("Upload one complete HTML template document.");
  if (Object.entries(attrs(roots[0])).some(([key, value]) => key !== "lang" || !/^[a-zA-Z-]{1,20}$/.test(value)))
    throw new Error("Unsupported HTML document attributes.");
  const document = entries(roots[0].html).filter((node) => tag(node) !== "#text" || String(node["#text"]).trim());
  if (document.length !== 2 || tag(document[0]) !== "head" || tag(document[1]) !== "body")
    throw new Error("HTML must contain one head and one body.");
  if (Object.keys(attrs(document[0])).length || Object.keys(attrs(document[1])).length)
    throw new Error("Unsupported HTML head or body attributes.");
  let descriptor: z.infer<typeof descriptorSchema> | undefined;
  let css = "";
  for (const node of entries(document[0].head)) {
    const name = tag(node);
    if (name === "#text" && !String(node["#text"]).trim()) continue;
    if (name === "title" && !Object.keys(attrs(node)).length) {
      text(node.title);
      continue;
    }
    if (name === "meta") {
      const attributes = attrs(node);
      if (attributes.charset === "utf-8" && Object.keys(attributes).length === 1) continue;
      if (
        attributes["http-equiv"] === "Content-Security-Policy" &&
        attributes.content === BADGE_PRINT_CONTENT_SECURITY_POLICY &&
        Object.keys(attributes).length === 2
      )
        continue;
      if (
        attributes.name === "referrer" &&
        attributes.content === "no-referrer" &&
        Object.keys(attributes).length === 2
      )
        continue;
      if (
        attributes.name !== "badge-template" ||
        Object.keys(attributes).some((key) => !["name", "content"].includes(key)) ||
        descriptor
      )
        throw new Error("Only template metadata is accepted.");
      descriptor = descriptorSchema.parse(JSON.parse(attributes.content));
    } else if (name === "style" && !Object.keys(attrs(node)).length) css += text(node.style);
    else throw new Error("Active HTML, scripts, links, and external resources are not accepted.");
  }
  if (!descriptor) throw new Error("HTML needs badge-template metadata defining its dimensions and sponsor groups.");
  const sides: Record<string, string> = {};
  for (const node of entries(document[1].body)) {
    if (tag(node) === "#text" && !String(node["#text"]).trim()) continue;
    const attributes = attrs(node),
      side = attributes["data-badge-side"];
    if (
      tag(node) !== "section" ||
      !["front", "back"].includes(side) ||
      Object.keys(attributes).length !== 1 ||
      sides[side] !== undefined
    )
      throw new Error("HTML needs unique front and back sections.");
    sides[side] = serialize(node.section);
  }
  css = css.replace(/url\(\s*["']?(data:[^"'\s)]+)["']?\s*\)/g, (_, url: string) => `url("${assetFromUrl(url)}")`);
  return eventBadgeTemplateSchema.parse({
    ...descriptor,
    frontHtml: sides.front ?? "",
    backHtml: sides.back ?? "",
    css,
    assets,
  });
}
