/** Only canonical, sanitized print-renderer output belongs in this adapter. */
export function badgePrintPreviewDocument(html: string): { html: string; css: string } {
  // Label documents already use stylesheet classes. Avoid constructing and serializing
  // thousands of pages in a second DOM before the iframe parses the same document.
  if (!/\sstyle\s*=/i.test(html)) {
    const rules: string[] = [];
    const document = html.replace(/<style>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
      rules.push(css);
      return "";
    });
    return { html: document, css: rules.join("\n") };
  }
  const fragment = document.createElement("template");
  fragment.innerHTML = html;
  const rules: string[] = [];
  for (const style of fragment.content.querySelectorAll("style")) {
    rules.push(style.textContent ?? "");
    style.remove();
  }
  let index = 0;
  for (const element of fragment.content.querySelectorAll("[style]")) {
    const className = `badge-preview-position-${index++}`;
    rules.push(`.${className}{${element.getAttribute("style") ?? ""}}`);
    element.classList.add(className);
    element.removeAttribute("style");
  }
  const preview = document.implementation.createHTMLDocument("");
  preview.documentElement.lang = "en";
  preview.head.replaceChildren();
  for (const element of fragment.content.querySelectorAll("meta,title")) preview.head.append(element);
  preview.body.append(fragment.content);
  return { html: `<!doctype html>${preview.documentElement.outerHTML}`, css: rules.join("\n") };
}

export function badgePreviewFontDescriptors(style: CSSStyleDeclaration): FontFaceDescriptors {
  const display = style.getPropertyValue("font-display") || "auto";
  if (
    display !== "auto" &&
    display !== "block" &&
    display !== "swap" &&
    display !== "fallback" &&
    display !== "optional"
  ) {
    throw new Error("The embedded badge font has an unsupported display policy.");
  }
  return {
    style: style.getPropertyValue("font-style") || "normal",
    weight: style.getPropertyValue("font-weight") || "normal",
    stretch: style.getPropertyValue("font-stretch") || "normal",
    unicodeRange: style.getPropertyValue("unicode-range") || "U+0-10FFFF",
    featureSettings: style.getPropertyValue("font-feature-settings") || "normal",
    display,
  };
}

export async function waitBadgePrintPreviewImages(frame: HTMLIFrameElement, document: Document): Promise<boolean> {
  const realm = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!realm) return false;
  const vectors = [
    ...new Set(Array.from(document.querySelectorAll("svg image"), (image) => image.getAttribute("href"))),
  ];
  await Promise.all([
    ...Array.from(document.images, (image) => image.decode()),
    ...vectors
      .filter((source): source is string => Boolean(source?.startsWith("data:image/")))
      .map((source) => {
        const image = new realm.Image();
        image.src = source;
        return image.decode();
      }),
    document.fonts?.ready,
  ]);
  return frame.isConnected && frame.contentDocument === document;
}

/** Construct the sheet in the frame's realm; cross-document adoption is forbidden. */
export async function applyBadgePrintPreviewStyles(frame: HTMLIFrameElement, css: string): Promise<boolean> {
  const document = frame.contentDocument;
  const realm = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!document || !realm?.CSSStyleSheet || !("adoptedStyleSheets" in document)) {
    throw new Error("This browser cannot display the print preview. Download the HTML print file to preview it.");
  }
  const sheet = new realm.CSSStyleSheet();
  if (typeof sheet.replaceSync !== "function") {
    throw new Error("This browser cannot display the print preview. Download the HTML print file to preview it.");
  }
  sheet.replaceSync(css);
  for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
    const rule = sheet.cssRules[index];
    if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
    const fontRule = rule as CSSFontFaceRule;
    const source = fontRule.style.getPropertyValue("src");
    const encoded = /url\(["']?data:font\/[^;,]+;base64,([A-Za-z0-9+/=]+)["']?\)/.exec(source);
    if (!encoded || !realm.FontFace) throw new Error("Could not load the embedded badge font.");
    const bytes = Uint8Array.from(atob(encoded[1]), (character) => character.charCodeAt(0));
    const family = fontRule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "");
    const font = new realm.FontFace(family, bytes, badgePreviewFontDescriptors(fontRule.style));
    await font.load();
    document.fonts.add(font);
    sheet.deleteRule(index);
  }
  if (frame.contentDocument !== document || !frame.isConnected) return false;
  document.adoptedStyleSheets = [sheet];
  return waitBadgePrintPreviewImages(frame, document);
}
