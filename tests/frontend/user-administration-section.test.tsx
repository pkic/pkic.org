// @vitest-environment jsdom
/**
 * Account administration is disclosed, not shown: a record is about the
 * person, and the operations on their account stay out of its reading order
 * until somebody comes to use them. A disclosure has to behave like one.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { UserAdministrationSection } from "../../assets/ts/member-flows/portal/sections/system-users/UserAdministrationSection";

let container: HTMLElement | null = null;

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("account administration disclosure", () => {
  it("opens closed, announces its state, and keeps the surfaces mounted while closed", async () => {
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <UserAdministrationSection>
          <input aria-label="Add address" />
        </UserAdministrationSection>,
        container!,
      ),
    );
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Account administration"]')!;
    const region = [...container.querySelectorAll<HTMLElement>("[id]")].find(
      (element) => element.id === toggle.getAttribute("aria-controls"),
    )!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);

    // A half-typed address survives the section being closed by mistake.
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.value = "half-typed@example.test";
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);

    await act(async () => toggle.click());
    expect(region.hidden).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("half-typed@example.test");
  });
});
