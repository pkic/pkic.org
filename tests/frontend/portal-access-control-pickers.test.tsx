// @vitest-environment jsdom
/**
 * The two small access-control surfaces: the resource-target picker a grant
 * is scoped with, and the capability list a resource is described by.
 *
 * Both were unnamed before — the target-type menu was a bare `<select>` with
 * no label at all, and the capability pills were `<span class="badge">` with
 * no fallback for an empty list. What is asserted here is the naming, not the
 * appearance.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TargetPicker,
  type PickedTarget,
} from "../../assets/ts/member-flows/portal/sections/access-control/TargetPicker";
import { chooseOption, controlFor, labelNames } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container));
  mounted.push(container);
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("permission target picker", () => {
  it("names the target-type menu and explains what an empty target means", () => {
    const container = mount(<TargetPicker value={{ targetType: null, targetId: null }} onChange={() => undefined} />);

    expect(labelNames(container)).toEqual(["Target type"]);
    const select = controlFor<HTMLSelectElement>(container, "Target type");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Global (no target)",
      "Event",
      "Group",
      "Organization",
    ]);
    // The help is wired to the control rather than floating beside it, so the
    // two are read together.
    const describedBy = select.getAttribute("aria-describedby");
    expect(container.querySelector(`#${describedBy!}`)?.textContent).toBe("A grant with no target applies everywhere.");
  });

  it("clears the chosen target when the kind changes", async () => {
    const changes: PickedTarget[] = [];
    const container = mount(
      <TargetPicker
        value={{ targetType: "group", targetId: "30000000-0000-4000-8000-000000000001" }}
        onChange={(next) => changes.push(next)}
      />,
    );

    await chooseOption(controlFor(container, "Target type"), "organization");
    expect(changes).toEqual([{ targetType: "organization", targetId: null }]);
  });

  it("says what went wrong when the target catalog cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("targets unavailable", { status: 503 }))),
    );

    const container = mount(
      <TargetPicker value={{ targetType: "group", targetId: null }} onChange={() => undefined} />,
    );
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
  });
});
