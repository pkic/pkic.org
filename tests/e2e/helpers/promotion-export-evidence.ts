import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import sharp from "sharp";
import jsQR from "jsqr";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import type { promotionFormatSchema } from "../../../assets/shared/schemas/event-promotion-kit";
import type { z } from "zod";

const runFile = promisify(execFile);
export const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();
type Format = z.infer<typeof promotionFormatSchema>;
type ImageEvidence = {
  file: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  phoneFile: string;
  phoneSha256: string;
  qr: string | null;
};

async function inspectImage(file: string, registrationUrl: string, qrExpected: boolean): Promise<ImageEvidence> {
  const bytes = await readFile(file);
  const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const qr = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height)?.data ?? null;
  expect(qr, `QR destination in ${file}`).toBe(qrExpected ? registrationUrl : null);
  const phoneFile = file.replace(/\.png$/u, "-phone.png");
  const phone = await sharp(bytes).resize({ width: 390 }).png().toBuffer();
  await writeFile(phoneFile, phone);
  return {
    file,
    sha256: digest(bytes),
    bytes: bytes.length,
    width: pixels.info.width,
    height: pixels.info.height,
    phoneFile,
    phoneSha256: digest(phone),
    qr,
  };
}

function inspectPdfStructure(pdf: PDFDocument, registrationUrl: string) {
  const root = pdf.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
  const roles: string[] = [];
  const figures: string[] = [];
  const parentTree = root.lookup(PDFName.of("ParentTree"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
  const pageParents = new Map<string, PDFArray>();
  const contentOrder = new Map<string, number[]>();
  for (const page of pdf.getPages()) {
    const key = page.node.lookup(PDFName.of("StructParents"), PDFNumber).asNumber();
    const values = parentTree.asArray();
    const position = values.findIndex((value) => value instanceof PDFNumber && value.asNumber() === key);
    expect(position).toBeGreaterThanOrEqual(0);
    pageParents.set(page.ref.toString(), pdf.context.lookup(values[position + 1]!, PDFArray));
    contentOrder.set(page.ref.toString(), []);
  }
  const walk = (node: PDFDict) => {
    const role = node.get(PDFName.of("S"));
    if (role instanceof PDFName) roles.push(role.decodeText());
    if (role?.toString() === "/Figure") figures.push(node.lookup(PDFName.of("Alt"), PDFString).decodeText());
    const children = node.get(PDFName.of("K"));
    if (children instanceof PDFArray)
      for (const child of children.asArray()) {
        const value = pdf.context.lookup(child);
        if (!(value instanceof PDFDict)) continue;
        if (value.get(PDFName.of("Type"))?.toString() === "/MCR") {
          const page = value.get(PDFName.of("Pg"))!.toString();
          const mcid = value.lookup(PDFName.of("MCID"), PDFNumber).asNumber();
          expect(pageParents.get(page)?.lookup(mcid, PDFDict)).toBe(node);
          contentOrder.get(page)!.push(mcid);
        } else walk(value);
      }
  };
  walk(root);
  for (const ids of contentOrder.values()) {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => index));
  }
  expect(roles[0]).toBe("Document");
  expect(roles.filter((role) => role === "H1")).toHaveLength(1);
  expect(roles.filter((role) => role === "H2").length).toBeGreaterThanOrEqual(3);
  expect(roles).toContain("LI");
  expect(roles.at(-1)).toBe("Link");
  expect(figures).toEqual([`QR code: register for this event at ${registrationUrl}`]);
  const links: Array<{ page: number; url: string }> = [];
  for (const [index, page] of pdf.getPages().entries()) {
    const parent = page.node.lookup(PDFName.of("StructParents"), PDFNumber).asNumber();
    expect(parentTree.asArray().some((value) => value instanceof PDFNumber && value.asNumber() === parent)).toBe(true);
    const annotations = page.node.get(PDFName.of("Annots"));
    if (!(annotations instanceof PDFArray)) continue;
    for (const value of annotations.asArray()) {
      const annotation = pdf.context.lookup(value, PDFDict);
      const action = annotation.lookup(PDFName.of("A"), PDFDict);
      const url = action.lookup(PDFName.of("URI"), PDFString).decodeText();
      expect(url).toBe(registrationUrl);
      expect(annotation.lookup(PDFName.of("StructParent"), PDFNumber).asNumber()).toBeGreaterThanOrEqual(
        pdf.getPageCount(),
      );
      links.push({ page: index + 1, url });
    }
  }
  expect(links).toEqual([{ page: pdf.getPageCount(), url: registrationUrl }]);
  return { roles, figures, links, contentOrder: [...contentOrder.values()] };
}

/** Read the actual delivered export; never substitute a preview or renderer source object. */
export async function inspectPromotionExport(options: {
  directory: string;
  format: Format;
  contentType: string;
  bytes: Buffer;
  registrationUrl: string;
  sessionUrl: string;
  expectedPdfText: string[];
}) {
  const { directory, format, contentType, bytes, registrationUrl } = options;
  await mkdir(directory, { recursive: true });
  const extension = contentType.includes("application/pdf")
    ? "pdf"
    : contentType.includes("application/zip")
      ? "zip"
      : "png";
  const file = join(directory, `download-${format}.${extension}`);
  await writeFile(file, bytes);
  const base = { format, file, sha256: digest(bytes), bytes: bytes.length, contentType };
  if (format === "carousel") {
    expect(contentType).toContain("application/pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    const structure = inspectPdfStructure(pdf, registrationUrl);
    const extracted = await runFile("pdftotext", ["-enc", "UTF-8", file, "-"], { maxBuffer: 4 * 1024 * 1024 });
    const text = normalized(extracted.stdout);
    for (const expected of options.expectedPdfText) expect(text).toContain(normalized(expected));
    // The long canonical URL can wrap inside its unbroken token. Preserve
    // every character while ignoring only the extraction's line whitespace.
    expect(extracted.stdout.replace(/\s+/gu, "")).toContain(options.sessionUrl);
    const sections = [
      options.expectedPdfText[0]!,
      "What you will take away",
      "Meet the panel",
      options.expectedPdfText.at(-1)!,
    ];
    const positions = sections.map((section) => text.indexOf(normalized(section)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const counters = [...extracted.stdout.matchAll(/(?:^|\n)\s*(\d+)\s*\/\s*(\d+)\s*(?=\n|$)/gu)].map((match) => [
      Number(match[1]),
      Number(match[2]),
    ]);
    expect(counters).toEqual(Array.from({ length: pdf.getPageCount() }, (_, index) => [index + 1, pdf.getPageCount()]));
    await writeFile(join(directory, "selectable-text.txt"), extracted.stdout);
    // Two pixels per PDF point, producing 1080×1350 for canonical pages.
    await runFile("pdftoppm", ["-r", "144", "-png", file, join(directory, "pdf-page")], { maxBuffer: 1024 * 1024 });
    const names = (await readdir(directory))
      .filter((name) => /^pdf-page-\d+\.png$/u.test(name))
      .sort((a, b) => Number(a.match(/\d+/u)![0]) - Number(b.match(/\d+/u)![0]));
    expect(names).toHaveLength(pdf.getPageCount());
    const pages = [];
    for (const [index, name] of names.entries()) {
      const image = await inspectImage(join(directory, name), registrationUrl, index === names.length - 1);
      expect([image.width, image.height]).toEqual([1080, 1350]);
      pages.push({ page: index + 1, pdfSha256: base.sha256, ...image });
    }
    return { ...base, title: pdf.getTitle(), pageCount: pdf.getPageCount(), structure, pages };
  }
  const imagePaths: string[] = [];
  if (extension === "zip") {
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const listing = await runFile("unzip", ["-Z1", file], { maxBuffer: 1024 * 1024 });
    const members = listing.stdout.trim().split("\n");
    expect(new Set(members).size).toBe(members.length);
    expect(members.length).toBeGreaterThan(1);
    for (const [index, member] of members.entries()) {
      // Only generated flat canonical members, no extraction paths or symlinks.
      expect(member).toBe(`session-${format}-${String(index + 1).padStart(2, "0")}.png`);
      const output = await runFile("unzip", ["-p", file, member], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
      const imagePath = join(directory, member);
      await writeFile(imagePath, output.stdout);
      imagePaths.push(imagePath);
    }
  } else {
    expect(contentType).toContain("image/png");
    imagePaths.push(file);
  }
  const dimensions = format === "square" ? [1080, 1080] : format === "portrait" ? [1080, 1350] : [1200, 630];
  const pages = [];
  for (const [index, imagePath] of imagePaths.entries()) {
    const image = await inspectImage(imagePath, registrationUrl, true);
    expect([image.width, image.height]).toEqual(dimensions);
    pages.push({ page: index + 1, exportSha256: base.sha256, ...image });
  }
  return { ...base, pageCount: pages.length, pages };
}
