// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { ConsentCard, ConsentList } from "../../assets/ts/components/ConsentCard";
import { loadSpeakerPageData } from "../../assets/ts/event-flows/speaker-link-recovery";
import { controlFor, labelNames } from "./helpers/labelled-control";

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
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public shared frontend abstractions", () => {
  it("keeps featured and compact consent cards on the same interactive frame", () => {
    const compact = mount(
      <ConsentCard
        term={{ termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" }}
      />,
    );
    const featured = mount(
      <ConsentCard
        term={{
          termKey: "conduct",
          version: "2",
          required: false,
          contentRef: "/conduct/",
          displayText: "Code of conduct",
          helpText: "Please review this policy.",
        }}
      />,
    );

    // Both shapes agree through one real checkbox, named by its own label —
    // not a div claiming role="checkbox" that only a mouse could reach.
    for (const [container, label] of [
      [compact, "Privacy"],
      [featured, "Code of conduct"],
    ] as const) {
      const consent = controlFor(container, label);
      expect(consent.type).toBe("checkbox");
      expect(consent.checked).toBe(false);
      void act(() => consent.click());
      expect(consent.checked).toBe(true);
    }
    expect(featured.textContent).toContain("Please review this policy.");
    // The help text is not just nearby, it is announced with the control.
    const conduct = controlFor(featured, "Code of conduct");
    const describedBy = conduct.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(featured.querySelector(`#${describedBy ?? ""}`)?.textContent).toContain("Please review this policy.");
  });

  it("announces a required consent that a validation pass rejected", () => {
    const container = mount(
      <ConsentCard
        term={{ termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" }}
      />,
    );
    const form = document.createElement("form");
    document.body.append(form);
    const consent = controlFor(container, "Privacy");
    form.append(consent);

    expect(container.querySelector('[role="alert"]')).toBeNull();

    // What the event flows do on submit: the platform fires `invalid` at every
    // control that fails, and the card takes its state from that rather than
    // from a script reaching in to set a class.
    void act(() => {
      form.checkValidity();
    });

    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toContain("You need to agree to this to continue.");
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(consent.getAttribute("aria-describedby")).toBe(message?.id);

    // Agreeing clears it, without anything else having to be told.
    void act(() => consent.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(consent.getAttribute("aria-invalid")).toBeNull();
    form.remove();
  });

  it("names the consent list's terms without repeating an unagreed one as required", () => {
    const container = mount(
      <ConsentList
        terms={[
          { termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" },
          { termKey: "news", version: "1", required: false, contentRef: null, displayText: "Newsletter" },
        ]}
      />,
    );
    expect(labelNames(container)).toEqual(["Privacy", "Newsletter"]);
    expect(controlFor(container, "Privacy").required).toBe(true);
    expect(controlFor(container, "Newsletter").required).toBe(false);
    // "Optional" is a word, not a colour, so a reader who cannot separate the
    // hues still knows which of the two they may skip.
    expect(container.textContent).toContain("Optional");
  });

  it("reports no consents as a sentence rather than an empty region", () => {
    const container = mount(<ConsentList terms={[]} />);
    expect(container.textContent).toContain("No required consents for this flow.");
    expect(container.querySelector("input")).toBeNull();
  });

  it("loads speaker-page data once the common token context is valid", async () => {
    window.history.replaceState({}, "", "/speaker/?token=shared-token");
    document.body.innerHTML = `
      <main data-speaker-test data-event-slug="event-1" data-api-base="/api/v1">
        <form><div data-flow-status></div></form>
        <div data-speaker-loading></div><div data-speaker-content></div>
      </main>`;
    const request = vi.fn(async () => ({ speaker: "Ada" }));

    const loaded = await loadSpeakerPageData({ selector: "[data-speaker-test]", request });

    expect(request).toHaveBeenCalledWith("shared-token", expect.objectContaining({ eventSlug: "event-1" }));
    expect(loaded?.token).toBe("shared-token");
    expect(loaded?.data).toEqual({ speaker: "Ada" });
  });
});
