import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalNavigationShell } from "../../assets/ts/member-flows/portal/shell/PortalNavigationShell";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/management", vi.fn()],
}));

let container: HTMLDivElement;

beforeEach(() => {
  window.location.hash = "#/management";
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  window.location.hash = "";
});

function mountNavigation(): void {
  void act(() =>
    render(
      <PortalNavigationShell session={portalSessionFixture({ admin: true })} displayName="Portal Tester">
        <p>Page content</p>
      </PortalNavigationShell>,
      container,
    ),
  );
}

describe("portal navigation shell", () => {
  it("exposes one labelled navigation and controlled mobile drawer", () => {
    mountNavigation();
    const toggle = container.querySelector<HTMLButtonElement>("#portal-sidebar-toggle")!;
    const sidebar = container.querySelector<HTMLElement>("#portal-sidebar")!;
    const backdrop = container.querySelector<HTMLButtonElement>("#portal-sidebar-backdrop")!;

    expect(sidebar.getAttribute("aria-label")).toBe("Portal navigation");
    expect(toggle.getAttribute("aria-label")).toBe("Open navigation");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(backdrop.getAttribute("aria-label")).toBe("Close navigation");

    void act(() => toggle.click());
    expect(toggle.getAttribute("aria-label")).toBe("Close navigation");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.classList.contains("open")).toBe(true);
    expect(backdrop.classList.contains("active")).toBe(true);

    void act(() => backdrop.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.classList.contains("open")).toBe(false);
  });

  it("closes on Escape and restores focus to the drawer control", () => {
    mountNavigation();
    const toggle = container.querySelector<HTMLButtonElement>("#portal-sidebar-toggle")!;

    void act(() => toggle.click());
    void act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });
});
