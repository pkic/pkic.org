// @vitest-environment jsdom
/**
 * One line weight for every UI icon.
 *
 * The weight is a design token drawn through `.pk-icon` with a non-scaling
 * stroke, so a glyph must neither carry a stroke width of its own nor be a
 * solid shape standing in for an outline. Brand marks are the one exception:
 * a network's logo is drawn the way the network publishes it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import * as portalIcons from "../../assets/ts/components/icons";
import * as navigationIcons from "../../assets/ts/components/icons/app-navigation";
import * as indicatorIcons from "../../assets/ts/components/icons/indicators";
import * as siteIcons from "../../assets/ts/ui/MediaIcons";
import { StateIcon } from "../../assets/ts/ui/Field";
import { applyFieldState, FIELD_STATES } from "../../assets/ts/ui/field-state";
import { constants } from "../../assets/design/tokens.ts";

const BRAND_MARKS = new Set(["IconLinkedIn", "IconXTwitter", "IconBluesky", "IconReddit"]);

type IconComponent = (props: Record<string, unknown>) => preact.JSX.Element;

function iconsOf(...modules: Record<string, unknown>[]): [string, IconComponent][] {
  const seen = new Map<string, IconComponent>();
  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) {
      if (/^Icon[A-Z]/.test(name) && typeof value === "function") seen.set(name, value as IconComponent);
    }
  }
  return [...seen];
}

function svgOf(markup: string): SVGSVGElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  const svg = root.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return svg;
}

const uiIcons = iconsOf(portalIcons, navigationIcons, indicatorIcons, siteIcons).filter(
  ([name]) => !BRAND_MARKS.has(name),
);

describe("UI icon weight", () => {
  it("states the weight once, in rendered pixels", () => {
    expect(constants["icon-stroke"]).toMatch(/^\d+(\.\d+)?px$/);
    expect(constants["icon-stroke-strong"]).toMatch(/^\d+(\.\d+)?px$/);
    expect(parseFloat(constants["icon-stroke-strong"])).toBeGreaterThan(parseFloat(constants["icon-stroke"]));

    const base = readFileSync(resolve(__dirname, "../../assets/design/base.css"), "utf8");
    expect(base).toMatch(/\.pk-icon\s*\{[^}]*stroke-width: var\(--pk-icon-stroke\);/);
    expect(base).toMatch(/\.pk-icon \*\s*\{\s*vector-effect: non-scaling-stroke;/);
  });

  it.each(uiIcons)("draws %s as an outline at the shared weight", (name, Icon) => {
    const props = name === "IconChevron" ? { pointing: "down" } : {};
    const svg = svgOf(render(<Icon {...props} />));
    expect(svg.classList.contains("pk-icon")).toBe(true);
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelector("[stroke-width]")).toBeNull();
    expect(svg.hasAttribute("stroke-width")).toBe(false);
  });

  it("keeps a caller's class beside the shared one", () => {
    const svg = svgOf(render(<siteIcons.IconCalendar class="pk-app-tabbar__icon" />));
    expect([...svg.classList]).toEqual(["pk-icon", "pk-app-tabbar__icon"]);
  });

  it("draws every session format from the shared set", () => {
    for (const format of Object.keys(siteIcons.SESSION_FORMAT_ICONS)) {
      expect(svgOf(render(<siteIcons.SessionFormatIcon format={format} />)).classList.contains("pk-icon")).toBe(true);
    }
    const unknown = render(<siteIcons.SessionFormatIcon format="unconference" />);
    expect(unknown).toBe(render(<siteIcons.IconPresentation />));
  });

  it("draws the field state marks as outlines in both rendering paths", () => {
    for (const state of FIELD_STATES) {
      const svg = svgOf(render(<StateIcon state={state} class="pk-field__state" />));
      expect(svg.classList.contains("pk-icon")).toBe(true);
      expect(svg.getAttribute("fill")).toBe("none");
    }

    const field = document.createElement("div");
    field.innerHTML = '<div class="pk-field__control"></div><p class="pk-field__message"></p>';
    applyFieldState(field, "invalid");
    for (const icon of field.querySelectorAll("svg")) {
      expect(icon.classList.contains("pk-icon")).toBe(true);
      expect(icon.getAttribute("fill")).toBe("none");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
    }
    expect(field.querySelectorAll("svg")).toHaveLength(2);
  });
});
