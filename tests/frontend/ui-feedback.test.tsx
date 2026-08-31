// @vitest-environment jsdom
/**
 * Alert, Spinner, and EmptyState — feedback components that communicate state
 * to the user and accessibility tree.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Alert } from "../../assets/ts/ui/Alert";
import { Spinner } from "../../assets/ts/ui/Spinner";
import { EmptyState } from "../../assets/ts/ui/EmptyState";

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
});

describe("Alert", () => {
  it("announces info and ok alerts as status, not alert", () => {
    const infoAlert = mount(<Alert tone="info" />).querySelector("[role]") as HTMLElement;
    const okAlert = mount(<Alert tone="ok" />).querySelector("[role]") as HTMLElement;
    expect(infoAlert.getAttribute("role")).toBe("status");
    expect(okAlert.getAttribute("role")).toBe("status");
  });

  it("announces warn and danger alerts with role=alert for interruption", () => {
    const warnAlert = mount(<Alert tone="warn" />).querySelector("[role]") as HTMLElement;
    const dangerAlert = mount(<Alert tone="danger" />).querySelector("[role]") as HTMLElement;
    expect(warnAlert.getAttribute("role")).toBe("alert");
    expect(dangerAlert.getAttribute("role")).toBe("alert");
  });

  it("applies tone as a modifier class", () => {
    const okAlert = mount(<Alert tone="ok" />).querySelector(".pk-alert") as HTMLElement;
    const warnAlert = mount(<Alert tone="warn" />).querySelector(".pk-alert") as HTMLElement;
    const dangerAlert = mount(<Alert tone="danger" />).querySelector(".pk-alert") as HTMLElement;
    const infoAlert = mount(<Alert tone="info" />).querySelector(".pk-alert") as HTMLElement;

    expect(okAlert.className).toContain("pk-alert--ok");
    expect(warnAlert.className).toContain("pk-alert--warn");
    expect(dangerAlert.className).toContain("pk-alert--danger");
    expect(infoAlert.className).toContain("pk-alert--info");
  });

  it("defaults to info tone", () => {
    const alert = mount(<Alert />).querySelector(".pk-alert") as HTMLElement;
    expect(alert.className).toContain("pk-alert--info");
  });

  it("renders title only when provided", () => {
    const withTitle = mount(<Alert title="Problem">Details</Alert>);
    const withoutTitle = mount(<Alert>Details</Alert>);

    expect(withTitle.querySelector(".pk-alert__title")).not.toBeNull();
    expect(withTitle.querySelector(".pk-alert__title")?.textContent).toBe("Problem");
    expect(withoutTitle.querySelector(".pk-alert__title")).toBeNull();
  });

  it("renders body content as children", () => {
    const alert = mount(<Alert>Something happened</Alert>);
    expect(alert.querySelector(".pk-alert__body")?.textContent).toBe("Something happened");
  });
});

describe("Spinner", () => {
  it("exposes label in the accessibility tree even when visually hidden", () => {
    const container = mount(<Spinner labelHidden />);
    const label = container.querySelector(".pk-spinner__label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Loading…");
    expect(label?.className).toContain("pk-spinner__label--hidden");
  });

  it("renders visible label by default", () => {
    const container = mount(<Spinner label="Fetching data" />);
    const label = container.querySelector(".pk-spinner__label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Fetching data");
    expect(label?.className).not.toContain("pk-spinner__label--hidden");
  });

  it("marks the spinning circle aria-hidden", () => {
    const container = mount(<Spinner />);
    const circle = container.querySelector(".pk-spinner__circle");
    expect(circle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults to 'Loading…' label", () => {
    const container = mount(<Spinner />);
    expect(container.querySelector(".pk-spinner__label")?.textContent).toBe("Loading…");
  });

  it("applies size modifier", () => {
    const mdSpinner = mount(<Spinner size="md" />).querySelector(".pk-spinner") as HTMLElement;
    const smSpinner = mount(<Spinner size="sm" />).querySelector(".pk-spinner") as HTMLElement;

    expect(mdSpinner.className).toContain("pk-spinner--md");
    expect(smSpinner.className).toContain("pk-spinner--sm");
  });

  it("defaults to md size", () => {
    const spinner = mount(<Spinner />).querySelector(".pk-spinner") as HTMLElement;
    expect(spinner.className).toContain("pk-spinner--md");
  });
});

describe("EmptyState", () => {
  it("renders title", () => {
    const container = mount(<EmptyState title="No results" body="Try a different search" />);
    expect(container.querySelector(".pk-empty-state__title")?.textContent).toBe("No results");
  });

  it("renders body only when provided", () => {
    const withBody = mount(<EmptyState title="Empty" body="No items yet" />);
    const withoutBody = mount(<EmptyState title="Empty" />);

    expect(withBody.querySelector(".pk-empty-state__body")).not.toBeNull();
    expect(withBody.querySelector(".pk-empty-state__body")?.textContent).toBe("No items yet");
    expect(withoutBody.querySelector(".pk-empty-state__body")).toBeNull();
  });

  it("renders children in action slot", () => {
    const container = mount(
      <EmptyState title="Empty">
        <button>Create new</button>
      </EmptyState>,
    );
    expect(container.querySelector(".pk-empty-state__action button")).not.toBeNull();
    expect(container.querySelector(".pk-empty-state__action button")?.textContent).toBe("Create new");
  });

  it("announces as status region", () => {
    const container = mount(<EmptyState title="Empty" />) as HTMLElement;
    expect(container.querySelector(".pk-empty-state")?.getAttribute("role")).toBe("status");
  });
});
