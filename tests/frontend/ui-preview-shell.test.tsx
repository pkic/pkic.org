// @vitest-environment jsdom
/**
 * The preview's controls are the system's own knobs.
 *
 * They must write to the document element, not to component state, because
 * that is exactly how a real surface sets them: the portal stamps data-theme
 * and data-density on its shell and sets --pk-accent from the group record. A
 * control that only worked inside the preview would prove nothing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { PreviewShell, type PreviewSection } from "../../assets/ts/ui/preview/PreviewShell";
import { accentNeighbour, palette } from "../../assets/design/palette";

const sections: PreviewSection[] = [
  { id: "one", title: "Actions", note: "Where a person commits to something.", render: () => <p>first</p> },
  { id: "two", title: "Status", render: () => <p>second</p> },
];

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  const root = document.documentElement;
  for (const attribute of ["data-theme", "data-density", "data-radius"]) root.removeAttribute(attribute);
  root.style.removeProperty("--pk-accent");
  root.style.removeProperty("--pk-accent-2");
});

function pressIn(container: HTMLElement, group: string, name: string) {
  const scope = container.querySelector(`[aria-label="${group}"]`);
  const button = [...(scope?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`no "${name}" control in "${group}"`);
  void act(() => button.click());
  return button;
}

describe("PreviewShell", () => {
  it("renders a section per entry, with an anchor the contents list can reach", () => {
    const container = mount(<PreviewShell sections={sections} />);
    expect(container.querySelector("#one")).not.toBeNull();
    expect(container.querySelector("#two")).not.toBeNull();
    const links = [...container.querySelectorAll(".pk-preview__toc a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#one", "#two"]);
  });

  it("renders a section's note only when it has one", () => {
    const container = mount(<PreviewShell sections={sections} />);
    const notes = container.querySelectorAll(".pk-preview__note");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain("Where a person commits");
  });

  it("stamps the theme on the document, the way a real surface would", () => {
    const container = mount(<PreviewShell sections={sections} />);
    pressIn(container, "Theme", "Dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    pressIn(container, "Theme", "Light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("stamps density and radius as modes rather than per-component props", () => {
    const container = mount(<PreviewShell sections={sections} />);
    pressIn(container, "Density", "Compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    pressIn(container, "Radius", "Sharp");
    expect(document.documentElement.getAttribute("data-radius")).toBe("sharp");
  });

  it("sets the accent and its neighbour together, so gradients stay in step", () => {
    const container = mount(<PreviewShell sections={sections} />);
    pressIn(container, "Accent", "purple");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--pk-accent")).toBe(palette.purple);
    expect(root.style.getPropertyValue("--pk-accent-2")).toBe(palette[accentNeighbour.purple]);
  });

  it("marks exactly one option pressed in each control group", () => {
    const container = mount(<PreviewShell sections={sections} />);
    for (const group of ["Theme", "Density", "Radius", "Accent"]) {
      const scope = container.querySelector(`[aria-label="${group}"]`);
      const pressed = [...(scope?.querySelectorAll('[aria-pressed="true"]') ?? [])];
      expect(pressed, group).toHaveLength(1);
    }
  });

  it("offers every accent hue the palette allows, and never red", () => {
    const container = mount(<PreviewShell sections={sections} />);
    const scope = container.querySelector('[aria-label="Accent"]');
    const labels = [...(scope?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(Object.keys(accentNeighbour));
    expect(labels).not.toContain("red");
  });
});
