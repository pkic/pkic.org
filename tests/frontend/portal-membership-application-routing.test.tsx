// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/membership/applications", mocks.navigate],
}));

vi.mock("../../assets/ts/shared/api-client", () => ({
  getJson: vi.fn(async () => ({ categories: [] })),
}));

vi.mock("../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView", () => ({
  ApplicationDetailView: ({ applicationId }: { applicationId: string }) => (
    <div data-application-id={applicationId}>Application detail</div>
  ),
}));

vi.mock("../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationsList", () => ({
  ApplicationsList: ({ onViewApplication }: { onViewApplication: (id: string) => void }) => (
    <button type="button" onClick={() => onViewApplication("application-2")}>
      Open application
    </button>
  ),
}));

import { MembershipApplications } from "../../assets/ts/member-flows/portal/sections/membership-applications";

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
  mocks.navigate.mockReset();
});

describe("portal membership application routing", () => {
  it("opens a notification-linked application directly in its detail view", () => {
    // The way back to the collection is the detail view's own trail link
    // (asserted in portal-membership-applications.test.tsx); the index only
    // has to hand the routed id to the detail view.
    const container = mount(<MembershipApplications initialApplicationId="application-1" canWrite canApprove />);

    const detail = container.querySelector("[data-application-id='application-1']");
    expect(detail).not.toBeNull();
  });

  it("opens list rows at a stable portal detail URL", () => {
    const container = mount(<MembershipApplications canWrite={false} canApprove={false} />);

    void act(() => (container.querySelector("button") as HTMLButtonElement).click());

    expect(mocks.navigate).toHaveBeenCalledWith("/membership/applications/application-2");
  });
});
