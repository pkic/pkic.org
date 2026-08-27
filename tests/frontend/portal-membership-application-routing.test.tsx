// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/system/membership-applications", mocks.navigate],
}));

vi.mock("../../assets/ts/shared/api-client", () => ({
  getJson: vi.fn(async () => ({ categories: [] })),
}));

vi.mock("../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView", () => ({
  ApplicationDetailView: ({ applicationId, onBack }: { applicationId: string; onBack: () => void }) => (
    <button type="button" data-application-id={applicationId} onClick={onBack}>
      Back to applications
    </button>
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
  it("returns a notification-linked application to the canonical collection route", () => {
    const container = mount(<MembershipApplications initialApplicationId="application-1" canWrite canApprove />);

    const back = container.querySelector("button[data-application-id='application-1']") as HTMLButtonElement;
    expect(back).not.toBeNull();
    void act(() => back.click());

    expect(mocks.navigate).toHaveBeenCalledWith("/system/membership-applications");
  });

  it("opens list rows at a stable portal detail URL", () => {
    const container = mount(<MembershipApplications canWrite={false} canApprove={false} />);

    void act(() => (container.querySelector("button") as HTMLButtonElement).click());

    expect(mocks.navigate).toHaveBeenCalledWith("/system/membership-applications/application-2");
  });
});
