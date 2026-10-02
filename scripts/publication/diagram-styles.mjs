import { JSDOM } from "jsdom";
import { optimizePublicSvg } from "./optimize-public-svg.mjs";
import { optimize } from "svgo";

/** Compile Mermaid's presentation into an external stylesheet before publication. */
export function externalizeDiagramStyles(source, id) {
  const prefixed = optimize(source, {
    plugins: [{ name: "prefixIds", params: { prefix: id, prefixClassNames: false } }],
  }).data;
  const dom = new JSDOM(prefixed, { contentType: "image/svg+xml" });
  try {
    const document = dom.window.document;
    // SVGO namespaces SVG paint references; preserve accessibility references too.
    for (const element of document.querySelectorAll("[aria-labelledby], [aria-describedby]")) {
      for (const attribute of ["aria-labelledby", "aria-describedby"]) {
        const references = element.getAttribute(attribute);
        if (!references) continue;
        element.setAttribute(
          attribute,
          references
            .split(/\s+/)
            .map((reference) => (document.getElementById(`${id}__${reference}`) ? `${id}__${reference}` : reference))
            .join(" "),
        );
      }
    }
    const css = [];
    for (const style of document.querySelectorAll("style")) {
      css.push(style.textContent ?? "");
      style.remove();
    }
    let next = 0;
    for (const element of document.querySelectorAll("[style]")) {
      const name = `${id}-style-${next++}`;
      css.push(`.${name}{${element.getAttribute("style")}}`);
      element.classList.add(name);
      element.removeAttribute("style");
    }
    return { svg: optimizePublicSvg(document.documentElement.outerHTML), css: css.join("\n") };
  } finally {
    dom.window.close();
  }
}
