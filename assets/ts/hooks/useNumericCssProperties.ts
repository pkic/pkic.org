import { useId, useLayoutEffect } from "preact/hooks";

/** Bind calculated geometry through an owned stylesheet, without inline style attributes. */
export function useNumericCssProperties(properties: Record<`--${string}`, number>): string {
  const id = useId();
  const declarations = Object.entries(properties).map(([name, value]) => {
    if (!/^--[a-zA-Z0-9_-]+$/u.test(name) || !Number.isFinite(value))
      throw new TypeError("Calculated CSS properties require a custom property name and a finite number.");
    return `${name}:${value}`;
  });
  const rule = `[data-numeric-css-properties=${JSON.stringify(id)}]{${declarations.join(";")}}`;
  useLayoutEffect(() => {
    const stylesheet = new CSSStyleSheet();
    stylesheet.insertRule(rule);
    document.adoptedStyleSheets = [...(document.adoptedStyleSheets ?? []), stylesheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== stylesheet);
    };
  }, [rule]);
  return id;
}
