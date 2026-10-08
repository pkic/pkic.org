import { XMLParser } from "fast-xml-parser";

export interface BadgeTemplateNode {
  tag: string;
  attributes: Record<string, string>;
  children: (BadgeTemplateNode | string)[];
}

const tags = new Set([
  "div",
  "section",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "small",
]);
const textSlots = new Set(["displayName", "firstName", "lastName", "organization", "badgeRole"]);
const assetKey = /^[a-z][a-z0-9_-]{0,63}$/;

/** XML mode makes the accepted inert HTML grammar identical in both runtimes. */
export function parseBadgeTemplateMarkup(
  source: string,
  assets: ReadonlySet<string>,
  groups: ReadonlySet<string>,
): (BadgeTemplateNode | string)[] {
  if (
    [...source].some((character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0))) ||
    /<!|<\?/.test(source)
  )
    throw new Error("Declarations and control characters are not supported.");
  const raw: unknown = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  }).parse(`<div>${source}</div>`, true);
  let count = 0;
  function nodes(value: unknown, depth: number): (BadgeTemplateNode | string)[] {
    if (!Array.isArray(value) || depth > 32) throw new Error("Invalid or deeply nested template.");
    return value.map((entry: unknown) => {
      if (++count > 2000 || !entry || typeof entry !== "object") throw new Error("Template contains too many nodes.");
      const record = entry as Record<string, unknown>;
      if (typeof record["#text"] === "string") {
        const text = record["#text"];
        for (const match of text.matchAll(/{{([^{}]*)}}/g)) {
          const slot = match[1];
          if (!textSlots.has(slot) && slot !== "qr" && !(slot.startsWith("sponsors:") && groups.has(slot.slice(9))))
            throw new Error("Unknown badge template slot.");
          if ((slot === "qr" || slot.startsWith("sponsors:")) && text.trim() !== match[0])
            throw new Error("QR and sponsor slots must occupy a complete text node.");
        }
        if (/{{|}}/.test(text.replace(/{{[^{}]*}}/g, ""))) throw new Error("Malformed template slot.");
        return text;
      }
      const names = Object.keys(record).filter((key) => key !== ":@");
      if (names.length !== 1 || !tags.has(names[0])) throw new Error("Only inert badge HTML elements are supported.");
      const tag = names[0];
      const attributes: Record<string, string> = {};
      const attrs = record[":@"];
      if (attrs !== undefined && (!attrs || typeof attrs !== "object" || Array.isArray(attrs)))
        throw new Error("Invalid HTML attributes.");
      for (const [key, value] of Object.entries(attrs ?? {})) {
        if (typeof value !== "string" || value.includes("{{") || value.length > 500)
          throw new Error("Invalid HTML attribute.");
        if (
          (key === "class" && /^[a-zA-Z0-9 _-]*$/.test(value)) ||
          ["title", "aria-label"].includes(key) ||
          (key === "aria-hidden" && /^(true|false)$/.test(value)) ||
          (tag === "img" && key === "alt")
        )
          attributes[key] = value;
        else if (tag === "img" && ["width", "height"].includes(key) && /^\d{1,4}$/.test(value)) attributes[key] = value;
        else if (tag === "img" && key === "src" && value.startsWith("asset:") && assets.has(value.slice(6)))
          attributes[key] = value;
        else throw new Error("Unsupported HTML attribute or image source.");
      }
      if (tag === "img" && !attributes.src) throw new Error("Images must reference a template asset.");
      const children = nodes(record[tag], depth + 1);
      if (["img", "br"].includes(tag) && children.length) throw new Error("Void elements cannot have children.");
      return { tag, attributes, children };
    });
  }
  const wrapper = nodes(raw, 0)[0];
  if (typeof wrapper === "string" || !wrapper) throw new Error("Invalid template fragment.");
  return wrapper.children;
}

export function badgeTemplateCss(source: string, assetUrls: ReadonlyMap<string, string>): string {
  // No escapes or comments that can disguise a resource token. CSP independently blocks every external resource.
  if (
    /[<>\\]/.test(source) ||
    source.includes(String.fromCharCode(0)) ||
    /\/\*|@import\b|@page\b|image-set\s*\(|(?:https?|javascript|data):/i.test(source)
  )
    throw new Error("Unsupported stylesheet resource or syntax.");
  for (const match of source.matchAll(/@([a-z-]+)/gi))
    if (!["font-face", "media", "supports"].includes(match[1].toLowerCase()))
      throw new Error("Unsupported stylesheet rule.");
  const result = source.replace(/url\(\s*["']?asset:([a-z][a-z0-9_-]{0,63})["']?\s*\)/gi, (_, key: string) => {
    const url = assetUrls.get(key);
    if (!assetKey.test(key) || !url) throw new Error("Unknown stylesheet asset.");
    return `url("${url}")`;
  });
  if (/url\s*\(/i.test(source.replace(/url\(\s*["']?asset:[a-z][a-z0-9_-]{0,63}["']?\s*\)/gi, "")))
    throw new Error("Stylesheet URLs must reference a template asset.");
  return result;
}

export function badgeTemplateAssetBytes(base64: string): Uint8Array {
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function validateBadgeTemplateAsset(mime: string, base64: string): void {
  const bytes = badgeTemplateAssetBytes(base64);
  if (mime === "image/svg+xml") {
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    validateBadgeTemplateSvg(svg);
  } else if (mime === "font/woff2") {
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "wOF2") throw new Error("Invalid WOFF2 font.");
  } else if (mime === "font/ttf") {
    if (
      !(bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) &&
      String.fromCharCode(...bytes.slice(0, 4)) !== "true"
    )
      throw new Error("Invalid TrueType font.");
  } else throw new Error("Unsupported template asset type.");
}

/** Vector assets are inert image documents; no nested raster, scripts, hyperlinks, or network references. */
export function validateBadgeTemplateSvg(svg: string): void {
  if (
    !/^\s*<svg(?:\s|>)/.test(svg) ||
    /<!|<\?|<(?:script|style|foreignObject|iframe|image|use|a)\b|\bon[a-z]+\s*=|\b(?:href|src|class|style)\s*=|(?:https?|javascript|data):/i.test(
      svg.replace(/https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)/g, ""),
    )
  )
    throw new Error("SVG assets must contain only inert vector artwork.");
  if (
    /[\\]/.test(svg) ||
    [...svg.matchAll(/url\(([^)]*)\)/gi)].some(
      (match) => !/^#[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(match[1].trim().replace(/^["']|["']$/g, "")),
    ) ||
    /@import/i.test(svg)
  )
    throw new Error("SVG assets cannot reference external resources.");
  const parsed: unknown = new XMLParser({ preserveOrder: true }).parse(svg, true);
  const vectorTags = new Set([
    "svg",
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "title",
    "desc",
  ]);
  function inspect(value: unknown, depth: number): void {
    if (!Array.isArray(value) || depth > 32) throw new Error("Invalid vector artwork.");
    for (const entry of value as Record<string, unknown>[])
      for (const [tag, children] of Object.entries(entry)) {
        if (tag === "#text" || tag === ":@") continue;
        if (!vectorTags.has(tag)) throw new Error("Only inert vector drawing elements are supported.");
        inspect(children, depth + 1);
      }
  }
  inspect(parsed, 0);
}
