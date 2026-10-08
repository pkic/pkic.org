// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  badgePrintPreviewDocument,
  applyBadgePrintPreviewStyles,
  badgePreviewFontDescriptors,
  waitBadgePrintPreviewImages,
} from "../../assets/ts/components/event-badges/badge-print-preview-document";

describe("canonical badge iframe presentation", () => {
  it("preserves authoritative font character ranges and weight", () => {
    const style = document.createElement("span").style;
    // Font-face descriptors are not ordinary element style properties in JSDOM.
    const descriptors = new Map([
      ["unicode-range", "U+0100-02FF"],
      ["font-weight", "100 900"],
      ["font-style", "italic"],
      ["font-display", "swap"],
    ]);
    vi.spyOn(style, "getPropertyValue").mockImplementation((property) => descriptors.get(property) ?? "");
    expect(badgePreviewFontDescriptors(style)).toMatchObject({
      unicodeRange: "U+0100-02FF",
      weight: "100 900",
      style: "italic",
      display: "swap",
    });
  });
  it.each([false, true])("waits for owned QR decoding and fences removed frame: %s", async (removed) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const image = frame.contentDocument!.createElement("img");
    frame.contentDocument!.body.append(image);
    let finish!: () => void;
    image.decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let ready = false;
    const pending = waitBadgePrintPreviewImages(frame, frame.contentDocument!).then((value) => {
      ready = value;
    });
    await Promise.resolve();
    expect(image.decode).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
    if (removed) frame.remove();
    finish();
    await pending;
    expect(ready).toBe(!removed);
    frame.remove();
  });

  it("retains physical print CSS and owned vector/font resources without blocked inline styles", () => {
    const source = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>Owned print document</title><style>@page{size:105mm 148mm;margin:0}@font-face{font-family:Badge;src:url(data:font/woff2;base64,AAAA)}</style></head><body><svg width="0" style="position:absolute;overflow:hidden"><defs><symbol id="logo"></symbol></defs></svg><article style="left:0mm;top:0mm;width:105mm;height:148mm"><svg><use href="#logo"></use></svg></article></body></html>`;
    const result = badgePrintPreviewDocument(source);
    const document = new DOMParser().parseFromString(result.html, "text/html");
    expect(document.querySelectorAll("style,[style]")).toHaveLength(0);
    expect(document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(
      "default-src 'none'",
    );
    expect(document.title).toBe("Owned print document");
    expect(result.css).toContain("@page{size:105mm 148mm;margin:0}");
    expect(result.css).toContain("data:font/woff2;base64,AAAA");
    expect(result.css).toContain("width:105mm;height:148mm");
    expect(document.querySelector("use")?.getAttribute("href")).toBe("#logo");
    expect(document.querySelector("article")?.className).toContain("badge-preview-position-");
  });
  it("refuses unsupported preview styling rather than enabling an unstyled print", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    await expect(applyBadgePrintPreviewStyles(frame, "@page{size:105mm 148mm}")).rejects.toThrow(
      "cannot display the print preview",
    );
    frame.remove();
  });
});
