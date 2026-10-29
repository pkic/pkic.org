import { readMarkdownButton } from "./markdown-button";
import {
  contentAttributeNames,
  contentContainerNames,
  contentContainerSchema,
  type ContentContainer,
} from "./schemas/content-layout";
import { CONTENT_ASIDE_NAME, contentAsideSchema, type ContentAside } from "./schemas/content-aside";

const containerPattern = [...contentContainerNames].sort((left, right) => right.length - left.length).join("|");
export const CONTAINER_START = new RegExp(`^:{3,}(?:${containerPattern})\\b`, "m");
const CONTAINER_OPEN = new RegExp(`^(:{3,})(${containerPattern})\\b([^\\n]*)\\r?\\n`);
const NESTED_CONTAINER = new RegExp(`^(:{3,})(?:${containerPattern})\\b`);
export const ASIDE_START = /^:{3,}aside[ \t]*(?:\r?\n|$)/m;

type CodeFence = { marker: string; length: number };

/** Preserve meaningful indentation while removing empty lines at the block edges. */
function trimBlankLines(markdown: string): string {
  return markdown.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, "");
}

/** Track literal code examples independently from the surrounding colon containers. */
function codeFence(line: string, current: CodeFence | null): CodeFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return current;
  const marker = match[1][0];
  if (!current) return { marker, length: match[1].length };
  return marker === current.marker && match[1].length >= current.length && !match[2].trim() ? null : current;
}

/** Validate a container at strict publication/save boundaries with readable author feedback. */
function parseContentContainer(value: unknown): ContentContainer {
  const result = contentContainerSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => `${issue.path.join(".") || "Content block"}: ${issue.message}`).join("; "),
    );
  return result.data;
}

/** Card and item blocks belong directly to their owning collection. */
function validateContainerParent(block: ContentContainer, parent?: ContentContainer["type"]): void {
  const expected =
    block.type === "card"
      ? "cards"
      : block.type === "item"
        ? "grid"
        : block.type === "card-header" || block.type === "card-footer"
          ? "card"
          : null;
  if (expected && parent !== expected) throw new Error(`A ${block.type} block must be inside a ${expected} block.`);
}

/** Validate nested blocks and enforce the permitted direct children of each layout. */
function validateContainerChildren(block: ContentContainer): void {
  if (block.type === "button") {
    readMarkdownButton(block.markdown);
    return;
  }
  // Reading each child validates its descendants before the parent is returned.
  const children = splitMarkdownContainers(block.markdown);
  for (const child of children) if (typeof child !== "string") validateContainerParent(child, block.type);
  if (block.type === "card") {
    for (const section of ["card-header", "card-footer"])
      if (children.filter((child) => typeof child !== "string" && child.type === section).length > 1)
        throw new Error(`A card has at most one ${section} block.`);
    const footer = children.findIndex((child) => typeof child !== "string" && child.type === "card-footer");
    if (footer >= 0 && children.slice(footer + 1).some((child) => typeof child !== "string" || child.trim()))
      throw new Error("Place the card footer after its body.");
  }
  if (block.type !== "grid" && block.type !== "cards" && block.type !== "actions") return;
  const expected = block.type === "grid" ? "item" : block.type === "cards" ? "card" : "button";
  if (!children.some((child) => typeof child !== "string")) throw new Error("Add at least one layout item.");
  if (children.some((child) => (typeof child === "string" ? Boolean(child.trim()) : child.type !== expected)))
    throw new Error(`A ${block.type} block contains only ${expected} blocks.`);
}

/** Read one balanced container. Code examples never close the surrounding content block. */
export function readMarkdownContainer(source: string): { raw: string; block: ContentContainer } | null {
  const opening = CONTAINER_OPEN.exec(source);
  if (!opening) return null;
  const attributes: Record<string, string> = {};
  for (const attribute of opening[3].trim().split(/\s+/).filter(Boolean)) {
    const match = /^([a-z]+)=([a-z0-9-]+)$/.exec(attribute);
    if (!match || !contentAttributeNames.some((name) => name === match[1]) || attributes[match[1]])
      throw new Error("Use supported, unique content attributes.");
    attributes[match[1]] = match[2];
  }
  const fences = [opening[1].length];
  let code: CodeFence | null = null;
  let offset = opening[0].length;
  for (const line of source.slice(offset).match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line) break;
    const wasCode = code !== null;
    code = codeFence(line.trimEnd(), code);
    if (!wasCode && !code) {
      const nested = NESTED_CONTAINER.exec(line.trimEnd());
      const closing = /^(:{3,})[ \t]*$/.exec(line.trimEnd());
      if (nested) fences.push(nested[1].length);
      if (closing && closing[1].length === fences.at(-1)) {
        fences.pop();
        if (!fences.length) {
          const block = parseContentContainer({
            type: opening[2],
            ...attributes,
            markdown: trimBlankLines(source.slice(opening[0].length, offset)),
          });
          validateContainerChildren(block);
          return { raw: source.slice(0, offset + line.length), block };
        }
      }
    }
    offset += line.length;
  }
  return null;
}

/** Tokenizers preserve malformed author input as ordinary Markdown instead of interrupting rendering. */
export function tryReadMarkdownContainer(source: string): ReturnType<typeof readMarkdownContainer> {
  try {
    return readMarkdownContainer(source);
  } catch {
    return null;
  }
}

/** Share the same boundaries with publication without interpreting ordinary Markdown. */
export function splitMarkdownContainers(source: string): Array<string | ContentContainer> {
  const parts: Array<string | ContentContainer> = [];
  let code: CodeFence | null = null;
  let offset = 0;
  let plainStart = 0;
  for (const line of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line) break;
    if (offset < plainStart) {
      offset += line.length;
      continue;
    }
    const wasCode = code !== null;
    code = codeFence(line.trimEnd(), code);
    if (!wasCode && !code && CONTAINER_START.test(line)) {
      const aside = readMarkdownContainer(source.slice(offset));
      if (!aside) throw new Error("Close the content block with a matching colon fence.");
      if (offset > plainStart) parts.push(source.slice(plainStart, offset));
      parts.push(aside.block);
      plainStart = offset + aside.raw.length;
    }
    offset += line.length;
  }
  if (plainStart < source.length) parts.push(source.slice(plainStart));
  return parts;
}

/** A longer outer fence preserves nested containers when the visual editor saves. */
export function serializeMarkdownContainer(block: ContentContainer): string {
  parseContentContainer(block);
  const lengths = [...block.markdown.matchAll(/^(:{3,})[ \t]*$/gm)].map((match) => match[1].length + 1);
  const fence = ":".repeat(Math.max(3, ...lengths));
  const attributes = contentAttributeNames
    .filter((name) => block[name] !== undefined)
    .map((name) => `${name}=${block[name]}`);
  return `${fence}${block.type}${attributes.length ? " " + attributes.join(" ") : ""}\n${trimBlankLines(block.markdown)}\n${fence}`;
}

/** Strict aside adapter; invalid attributes retain the shared readable validation errors. */
export function readMarkdownAside(source: string): { raw: string; block: ContentAside } | null {
  const result = readMarkdownContainer(source);
  return result?.block.type === "aside" ? { ...result, block: contentAsideSchema.parse(result.block) } : null;
}
export const splitMarkdownAsides = splitMarkdownContainers;
/** Serialize editable aside children through the canonical container codec. */
export function serializeMarkdownAside(markdown: string): string {
  return serializeMarkdownContainer({ type: CONTENT_ASIDE_NAME, markdown });
}

/** Validate boundaries, attributes and structural children before replacing editor state. */
export function validateMarkdownAsides(source: string): void {
  for (const block of splitMarkdownContainers(source)) if (typeof block !== "string") validateContainerParent(block);
}
