import { badgePrintPreviewDocument, loadBadgePrintFonts } from "./badge-print-preview-document";

let releasePrevious: (() => void) | undefined;

/** Print an isolated top-level document: mobile browsers may ignore iframe.print(). */
export async function printBadgeDocument(html: string, isCurrent: () => boolean = () => true, signal?: AbortSignal) {
  if (signal?.aborted || !isCurrent()) return;
  releasePrevious?.();
  const prepared = badgePrintPreviewDocument(html);
  const parsed = new DOMParser().parseFromString(prepared.html, "text/html");
  const root = document.createElement("div");
  root.id = "pk-badge-print-command";
  root.append(...Array.from(parsed.body.childNodes, (node) => document.importNode(node, true)));
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("#pk-badge-print-command { display:none }");
  const cleanup = () => {
    root.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
    window.removeEventListener("afterprint", cleanup);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("hashchange", cleanup);
    signal?.removeEventListener("abort", cleanup);
    if (releasePrevious === cleanup) releasePrevious = undefined;
  };
  document.body.append(root);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  releasePrevious = cleanup;
  window.addEventListener("afterprint", cleanup, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("hashchange", cleanup, { once: true });
  signal?.addEventListener("abort", cleanup, { once: true });
  try {
    const fontSheet = new CSSStyleSheet();
    fontSheet.replaceSync(prepared.css);
    await loadBadgePrintFonts(document, fontSheet, window);
    const printCss = Array.from(fontSheet.cssRules, (rule) => rule.cssText).join("\n");
    sheet.replaceSync(`#pk-badge-print-command { display:none } @media print { body > :not(#pk-badge-print-command) { display:none!important }
    html,body { height:auto!important;min-height:0!important;overflow:visible!important;display:block!important; }
    #pk-badge-print-command { display:block!important;position:static; }
    ${printCss} }`);

    await Promise.all(Array.from(root.querySelectorAll("img"), (image) => image.decode()));
    await document.fonts.ready;
    if (releasePrevious !== cleanup || signal?.aborted || !isCurrent()) {
      cleanup();
      return;
    }
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
