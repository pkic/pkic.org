import { describe, expect, it } from "vitest";
import {
  renderOverlayTextHtml,
  renderOverlayTextMarkdown,
  validateOverlayTextTemplate,
} from "../../assets/shared/overlay-text-template";

describe("overlay text templates", () => {
  it("renders nested sponsor tiers, scalar lists, parent context and dotted names", () => {
    expect(
      renderOverlayTextHtml("{{#tiers}}**{{name}}**: {{#sponsors}}{{event.name}}/{{.}}; {{/sponsors}}{{/tiers}}", {
        event: { name: "Conference" },
        tiers: [{ name: "Gold", sponsors: ["One", "Two"] }],
      }),
    ).toBe("<strong>Gold</strong>: Conference/One; Conference/Two; ");
  });
  it("handles inverted/boolean sections, comments, missing values and empty arrays", () => {
    expect(
      renderOverlayTextMarkdown("{{! note}}{{#show}}{{title}}{{/show}}{{^items}}Empty{{/items}}{{missing}}", {
        show: true,
        title: "Hello ",
        items: [],
      }),
    ).toBe("Hello Empty");
  });
  it("keeps interpolated text literal and never expands interpolated templates", () => {
    const html = renderOverlayTextHtml("**{{name}}**", { name: "*Jane* <img src=x onerror=alert(1)> {{secret}} & Co" });
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.textContent).toBe("*Jane* <img src=x onerror=alert(1)> {{secret}} & Co");
    expect(div.querySelectorAll("strong")).toHaveLength(1);
    expect(div.querySelector("img, em")).toBeNull();
  });
  it("allows only bold and italic markup, including hostile template-authored HTML", () => {
    const div = document.createElement("div");
    div.innerHTML = renderOverlayTextHtml(
      "**Bold** and *italic* [click](javascript:alert(1)) <svg onload=alert(1)> ![x](evil)",
      {},
    );
    expect([...div.querySelectorAll("*")].map((node) => node.tagName)).toEqual(["STRONG", "EM"]);
    expect(div.textContent).toContain("<svg onload=alert(1)>");
  });
  it.each(["{{#x}}", "{{/x}}", "{{#x}}{{/y}}", "{{{x}}}", "{{& x}}", "{{x", "{{=x=}}"])(
    "rejects invalid or unsafe syntax: %s",
    (template) => {
      expect(validateOverlayTextTemplate(template)).not.toBeNull();
      expect(() => renderOverlayTextHtml(template, {})).toThrow();
    },
  );
  it("never reads inherited properties or invokes context functions and getters", () => {
    const context = Object.create({ inherited: "secret" });
    Object.defineProperty(context, "getter", {
      get() {
        throw new Error("must not execute");
      },
    });
    context.callback = () => {
      throw new Error("must not execute");
    };
    expect(renderOverlayTextHtml("{{inherited}}{{getter}}{{callback}}{{constructor.name}}", context)).toBe("");
  });
  it("bounds nested sections and expanding output", () => {
    expect(() => renderOverlayTextHtml("{{#x}}".repeat(40) + "{{/x}}".repeat(40), {})).toThrow();
    expect(() =>
      renderOverlayTextHtml("{{#items}}{{.}}{{/items}}", { items: Array(200).fill("x".repeat(1000)) }),
    ).toThrow();
  });
});
