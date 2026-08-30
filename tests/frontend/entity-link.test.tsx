// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityLink } from "../../assets/ts/components/EntityLink";
import { portalEntityHref } from "../../assets/ts/member-flows/portal/entity-links";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

let container: HTMLDivElement;

function mount(node: ComponentChildren): void {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container));
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container));
    container.remove();
  }
  portalSession.value = null;
});

describe("EntityLink", () => {
  it("renders a wouter Link when href is non-null", () => {
    mount(<EntityLink href="/users/1">Jane Doe</EntityLink>);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("#/users/1");
    expect(anchor?.textContent).toBe("Jane Doe");
  });

  it("degrades to a plain span when href is null so the name stays visible without a broken link", () => {
    mount(<EntityLink href={null}>Jane Doe</EntityLink>);
    expect(container.querySelector("a")).toBeNull();
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("Jane Doe");
  });
});

describe("portalEntityHref", () => {
  it("returns null for a null or empty entity id, regardless of entity type", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "admin" });
    expect(portalEntityHref("user", null)).toBeNull();
    expect(portalEntityHref("user", undefined)).toBeNull();
    expect(portalEntityHref("user", "")).toBeNull();
  });

  it("resolves a user route when the viewer has users:read", () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "staff",
      grants: [{ permission: "users:read", contextType: null, contextId: null }],
    });
    expect(portalEntityHref("user", "user-1")).toBe("/users/user-1");
  });

  it("denies a user route without users:read, degrading to text", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "staff", grants: [] });
    expect(portalEntityHref("user", "user-1")).toBeNull();
  });

  it("resolves a group route whenever the groups section is enabled for the session", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "staff", grants: [] });
    expect(portalEntityHref("group", "group-1")).toBe("/groups/group-1");
  });

  it("denies a group route for an unauthenticated session, degrading to text", () => {
    portalSession.value = null;
    expect(portalEntityHref("group", "group-1")).toBeNull();
  });

  it("resolves an organization route when the viewer has organizations:read", () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "staff",
      grants: [{ permission: "organizations:read", contextType: null, contextId: null }],
    });
    expect(portalEntityHref("organization", "org-1")).toBe("/organizations/org-1");
  });

  it("resolves an organization route when the viewer has membership:write instead of organizations:read", () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "staff",
      grants: [{ permission: "membership:write", contextType: null, contextId: null }],
    });
    expect(portalEntityHref("organization", "org-1")).toBe("/organizations/org-1");
  });

  it("denies an organization route without either organizations:read or membership:write", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "staff", grants: [] });
    expect(portalEntityHref("organization", "org-1")).toBeNull();
  });

  it("resolves a membership application route when the membership section is enabled", () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "staff",
      grants: [{ permission: "membership:read", contextType: null, contextId: null }],
    });
    expect(portalEntityHref("membership_application", "app-1")).toBe("/membership/applications/app-1");
    expect(portalEntityHref("application", "app-1")).toBe("/membership/applications/app-1");
  });

  it("denies a membership application route without membership:read", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "staff", grants: [] });
    expect(portalEntityHref("membership_application", "app-1")).toBeNull();
    expect(portalEntityHref("application", "app-1")).toBeNull();
  });

  it("returns null for entity types that need an owning group to route", () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "admin" });
    expect(portalEntityHref("event", "event-1")).toBeNull();
    expect(portalEntityHref("vote", "vote-1")).toBeNull();
    expect(portalEntityHref("some_unknown_type", "id-1")).toBeNull();
  });
});
