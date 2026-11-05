import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as preview from "../../assets/ts/components/event-badges/badge-print-preview-document";
import { printBadgeDocument } from "../../assets/ts/components/event-badges/badge-print-command";

const html =
  '<!doctype html><html><head><style>@page{size:38mm 89.8mm;margin:0}html,body{margin:0;padding:0}.badge-print-sheet{break-after:page}</style></head><body><section class="badge-print-sheet">Synthetic label</section></body></html>';
let print: ReturnType<typeof vi.spyOn>;
const rules: string[] = [];
beforeEach(() => {
  rules.length = 0;
  document.body.innerHTML = '<main id="portal">Portal controls</main>';
  Object.defineProperty(document, "adoptedStyleSheets", { configurable: true, writable: true, value: [] });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      cssRules: { cssText: string }[] = [];
      replaceSync(css: string) {
        this.cssRules = [{ cssText: css }];
        rules.push(css);
      }
    },
  );
  print = vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => {
  window.dispatchEvent(new Event("afterprint"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("prints only canonical sheets at the top level and restores the page after printing", async () => {
  await printBadgeDocument(html);
  expect(print).toHaveBeenCalledOnce();
  expect(document.querySelector("#pk-badge-print-command")?.hasAttribute("hidden")).toBe(false);
  expect(document.querySelector("#pk-badge-print-command")?.textContent).toBe("Synthetic label");
  expect(document.querySelector("#portal")?.textContent).toBe("Portal controls");
  expect(rules.join("\n")).toContain("body > :not(#pk-badge-print-command)");
  expect(rules.join("\n")).toContain("@page{size:38mm 89.8mm;margin:0}");
  window.dispatchEvent(new Event("afterprint"));
  expect(document.querySelector("#pk-badge-print-command")).toBeNull();
  expect(document.adoptedStyleSheets).toEqual([]);
});
it("clears print content when the owning view is canceled even if afterprint never fires", async () => {
  const owner = new AbortController();
  await printBadgeDocument(html, () => true, owner.signal);
  owner.abort();
  expect(document.querySelector("#pk-badge-print-command")).toBeNull();
  expect(document.adoptedStyleSheets).toEqual([]);
});
it("refuses stale or canceled output before invoking native printing", async () => {
  await printBadgeDocument(html, () => false);
  const owner = new AbortController();
  owner.abort();
  await printBadgeDocument(html, () => true, owner.signal);
  expect(print).not.toHaveBeenCalled();
  expect(document.querySelector("#pk-badge-print-command")).toBeNull();
});
it("replaces an earlier print document instead of printing both attendees", async () => {
  await printBadgeDocument(html);
  await printBadgeDocument(html.replace("Synthetic label", "Next label"));
  expect(document.querySelectorAll("#pk-badge-print-command")).toHaveLength(1);
  expect(document.querySelector("#pk-badge-print-command")?.textContent).toBe("Next label");
  expect(document.adoptedStyleSheets).toHaveLength(1);
});

it.each([false, true])("releases only owned fonts, including delayed loads after cancellation: %s", async (cancel) => {
  const owner = new AbortController();
  const registered = new Set<FontFace>();
  const portalFont = {} as FontFace;
  const badgeFont = {} as FontFace;
  registered.add(portalFont);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      delete: (font: FontFace) => registered.delete(font),
    },
  });
  let finish!: () => void;
  vi.spyOn(preview, "loadBadgePrintFonts").mockImplementation(async (_document, _sheet, _realm, owned = []) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    registered.add(badgeFont);
    owned.push(badgeFont);
  });
  const pending = printBadgeDocument(html, () => true, owner.signal);
  if (cancel) owner.abort();
  finish();
  await pending;
  if (!cancel) window.dispatchEvent(new Event("afterprint"));
  expect(registered).toEqual(new Set([portalFont]));
  expect(print).toHaveBeenCalledTimes(cancel ? 0 : 1);
});
