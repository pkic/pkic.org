/**
 * The words on uploaded slides, for the automatic check. PowerPoint files are
 * read here, slide by slide; PDF and documents go through Workers AI's
 * converter. Anything else, or a file too large to read, has no text and
 * stays unchecked.
 */
import type { Env } from "../../types";

/** Larger uploads are not read into memory for a check. */
export const PRESENTATION_CHECK_MAX_BYTES = 30 * 1024 * 1024;
/** The check reads at most this much of the slides' text. */
const MAX_TEXT_LENGTH = 20_000;
const MAX_SLIDES = 300;

const CONVERTED_EXTENSIONS = new Set(["pdf", "docx", "odt"]);

export function presentationExtension(fileName: string | null): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? "");
  return match ? match[1]!.toLowerCase() : "";
}

/** Whether the check can read a file of this name at all. */
export function presentationTextReadable(fileName: string | null): boolean {
  const extension = presentationExtension(fileName);
  return extension === "pptx" || CONVERTED_EXTENSIONS.has(extension);
}

/** The slides' text, or null when the file cannot be read. */
export async function extractPresentationText(
  env: Pick<Env, "AI">,
  file: { bytes: ArrayBuffer; fileName: string | null },
): Promise<string | null> {
  const extension = presentationExtension(file.fileName);
  let text: string | null = null;
  if (extension === "pptx") text = await pptxText(new Uint8Array(file.bytes));
  else if (CONVERTED_EXTENSIONS.has(extension) && env.AI?.toMarkdown) {
    const result = await env.AI.toMarkdown(
      { name: `slides.${extension}`, blob: new Blob([file.bytes]) },
      { conversionOptions: { output: { format: "text" } } },
    );
    text = result.format !== "error" ? (result.data ?? null) : null;
  }
  const trimmed = text?.replace(/[ \t]+\n/g, "\n").trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT_LENGTH) : null;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** The central directory of a zip file: where each entry is and how it is stored. */
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return [];
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count && at + 46 <= bytes.length; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function zipEntryText(bytes: Uint8Array, entry: ZipEntry): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== 0x04034b50) return null;
  const start =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) return null;
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Each slide's text runs, in slide order, one paragraph per line. */
async function pptxText(bytes: Uint8Array): Promise<string | null> {
  const slides = zipEntries(bytes)
    .map((entry) => ({ entry, number: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(entry.name)?.[1]) }))
    .filter((slide) => Number.isInteger(slide.number) && slide.number > 0)
    .sort((a, b) => a.number - b.number)
    .slice(0, MAX_SLIDES);
  if (!slides.length) return null;
  const parts: string[] = [];
  let length = 0;
  for (const { entry, number } of slides) {
    const xml = await zipEntryText(bytes, entry).catch(() => null);
    if (!xml) continue;
    const paragraphs = xml
      .split(/<\/a:p>/)
      .map((paragraph) => [...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((run) => decodeXml(run[1]!)).join(""))
      .filter((paragraph) => paragraph.trim());
    if (!paragraphs.length) continue;
    const slide = `Slide ${String(number)}:\n${paragraphs.join("\n")}`;
    parts.push(slide);
    length += slide.length;
    if (length > MAX_TEXT_LENGTH) break;
  }
  return parts.join("\n\n") || null;
}
