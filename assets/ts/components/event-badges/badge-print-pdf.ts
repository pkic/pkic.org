import { PDFDocument, type PDFImage } from "pdf-lib";
import { toCanvas } from "html-to-image";

const POINTS_PER_MM = 72 / 25.4;
const PRINT_SCALE = 300 / 96;

/** Inline the print renderer's shared SVG symbols before canvas serializes individual logos. */
function inlinePrintVectors(document: Document, root: HTMLElement) {
  for (const use of root.querySelectorAll("svg use")) {
    const href = use.getAttribute("href");
    const symbol = href?.startsWith("#") ? document.getElementById(href.slice(1)) : null;
    if (!symbol) throw new Error("A badge vector is unavailable.");
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const child of symbol.childNodes) group.append(child.cloneNode(true));
    use.replaceWith(group);
  }
  for (const shape of root.querySelectorAll(
    "svg path,svg rect,svg circle,svg ellipse,svg polygon,svg polyline,svg line,svg stop",
  )) {
    const style = document.defaultView!.getComputedStyle(shape);
    for (const name of ["fill", "stroke", "stop-color"]) {
      const value = style.getPropertyValue(name);
      if (value) shape.setAttribute(name, value.replace(/url\(["']?[^)"']*#([^)'" ]+)["']?\)/g, "url(#$1)"));
    }
  }
}

/** Capture the existing print sheets locally at print resolution; process one sheet at a time. */
export async function badgePrintPdf(
  document: Document,
  dimensions: { widthMm: number; heightMm: number },
  isCurrent: () => boolean,
  canonicalHtml = "",
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  await document.fonts.ready;
  const sheets = [...document.querySelectorAll<HTMLElement>(".badge-print-sheet")];
  if (!sheets.length) throw new Error("No print pages are available.");
  if (sheets.length > 200 && sheets.some((sheet) => !sheet.querySelector(".badge-label")))
    throw new Error("This selection is too large for one badge PDF. Select fewer attendees or use Print > Badges.");
  const fontCss = (canonicalHtml.match(/@font-face\s*\{[^}]*\}/g) ?? []).join("\n");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Attendee print file");
  pdf.setCreator("PKI Consortium");
  const images = new Map<string, PDFImage>();
  let completed = 0;
  for (const sheet of sheets) {
    if (!isCurrent()) throw new Error("This print job is no longer available.");
    const key = sheet.dataset.printKey;
    const cached = key ? images.get(key) : undefined;
    if (cached) {
      const page = pdf.addPage([dimensions.widthMm * POINTS_PER_MM, dimensions.heightMm * POINTS_PER_MM]);
      page.drawImage(cached, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      onProgress?.(++completed, sheets.length);
      continue;
    }
    const copy = sheet.cloneNode(true) as HTMLElement;
    copy.style.setProperty("position", "fixed");
    copy.style.setProperty("left", "0");
    copy.style.setProperty("top", "0");
    document.body.append(copy);
    let renderFailed = false;
    let canvas: HTMLCanvasElement;
    try {
      inlinePrintVectors(document, copy);
      canvas = await toCanvas(copy, {
        pixelRatio: PRINT_SCALE,
        width: (dimensions.widthMm * 96) / 25.4,
        height: (dimensions.heightMm * 96) / 25.4,
        backgroundColor: "#ffffff",
        fontEmbedCSS: fontCss,
        skipFonts: !fontCss,
        style: { position: "relative", left: "0", top: "0", margin: "0", zoom: "1", boxShadow: "none" },
        onImageErrorHandler: () => {
          renderFailed = true;
        },
      });
    } finally {
      copy.remove();
    }
    try {
      if (renderFailed) throw new Error("A print image could not be rendered. No PDF was downloaded.");
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Could not render this print page."))),
          "image/png",
        ),
      );
      const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
      if (key) images.set(key, image);
      const page = pdf.addPage([dimensions.widthMm * POINTS_PER_MM, dimensions.heightMm * POINTS_PER_MM]);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      // Flush each embedded image so decoded pixels do not accumulate across a large roster.
      await pdf.flush();
      onProgress?.(++completed, sheets.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  if (!isCurrent()) throw new Error("This print job is no longer available.");
  return new Blob([new Uint8Array(await pdf.save()).buffer], { type: "application/pdf" });
}
