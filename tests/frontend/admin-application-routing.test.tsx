// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../assets/ts/admin/sections/Applications/ApplicationDetailView", () => ({
  ApplicationDetailView: ({ applicationId, onBack }: { applicationId: string; onBack: () => void }) => (
    <button type="button" data-application-id={applicationId} onClick={onBack}>
      Back to applications
    </button>
  ),
}));

vi.mock("../../assets/ts/admin/sections/Applications/ApplicationsList", () => ({
  ApplicationsList: () => <p>Application list</p>,
}));

import { Applications } from "../../assets/ts/admin/sections/Applications";

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

describe("admin membership application routing", () => {
  it("opens a notification-linked application and returns to the collection route", () => {
    const onBackFromInitial = vi.fn();
    const container = mount(
      <Applications initialApplicationId="application-1" onBackFromInitial={onBackFromInitial} />,
    );

    const back = container.querySelector("button[data-application-id='application-1']") as HTMLButtonElement;
    expect(back).not.toBeNull();
    void act(() => back.click());

    expect(onBackFromInitial).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Application list");
  });
});
