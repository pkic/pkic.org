// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { BreadcrumbBranch, BreadcrumbScope } from "../../assets/ts/ui/BreadcrumbScope";
import { PanelHeader } from "../../assets/ts/ui/Panel";

const container = document.createElement("div");
const groups = [{ label: "Groups", href: "#/groups" }];
function show(node: ComponentChildren) {
  void act(() => render(node, container));
}
function labels() {
  return [...container.querySelectorAll("li")].map((item) => item.textContent);
}
afterEach(() => show(null));

describe("workspace breadcrumbs", () => {
  it("composes a deep record path with linked ancestors and one current location", () => {
    show(
      <BreadcrumbScope route="event/registrations/person" items={groups} label="Location">
        <BreadcrumbBranch
          items={[
            { label: "Conference", href: "#/event" },
            { label: "Registrations", href: "#/event/registrations" },
          ]}
        >
          <BreadcrumbBranch items={[{ label: "Alex" }]} />
        </BreadcrumbBranch>
      </BreadcrumbScope>,
    );
    expect(labels()).toEqual(["Groups", "Conference", "Registrations", "Alex"]);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "#/groups",
      "#/event",
      "#/event/registrations",
    ]);
    expect([...container.querySelectorAll('[aria-current="page"]')].map((node) => node.textContent)).toEqual(["Alex"]);
  });

  it("drops a departed record while the next route loads, then accepts its actual title", () => {
    const view = (route: string, title?: string) => (
      <BreadcrumbScope route={route} items={groups} label="Location">
        {title && <BreadcrumbBranch items={[{ label: title }]} />}
      </BreadcrumbScope>
    );
    show(view("first", "First list"));
    expect(labels()).toEqual(["Groups", "First list"]);
    show(view("second"));
    expect(labels()).toEqual(["Groups"]);
    show(view("second", "Second list"));
    expect(labels()).toEqual(["Groups", "Second list"]);
    show(view("second", "Renamed list"));
    expect(labels()).toEqual(["Groups", "Renamed list"]);
  });

  it("returns to the parent trail when a nested create form is cancelled", () => {
    const view = (creating: boolean) => (
      <BreadcrumbScope route="roles" items={[{ label: "Roles", href: "#/roles" }]} label="Location">
        {creating && <PanelHeader title="New role" headingLevel={2} breadcrumb />}
      </BreadcrumbScope>
    );
    show(view(true));
    expect(labels()).toEqual(["Roles", "New role"]);
    show(view(false));
    expect(labels()).toEqual(["Roles"]);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Roles");
  });
});
