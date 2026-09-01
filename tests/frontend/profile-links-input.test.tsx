// @vitest-environment jsdom
/**
 * The profile-links widget's own behaviour, as opposed to the normalizer it
 * is populated from (tests/frontend/profile-links.test.ts).
 *
 * Ten surfaces render this control, so what it rejects and what it announces
 * while rejecting are felt everywhere at once. Both are asserted here rather
 * than through any one of those surfaces.
 */
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileLinksInput } from "../../assets/ts/components/ProfileLinksInput";
import { typeInto } from "./helpers/labelled-control";

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

function urlField(root: ParentNode): HTMLInputElement {
  return root.querySelector<HTMLInputElement>('input[type="url"]')!;
}

function addButton(root: ParentNode): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('button[aria-label="Add profile link"]')!;
}

describe("ProfileLinksInput", () => {
  it("refuses a URL that is not http(s) and says so as an error, not just in a colour", async () => {
    const onChange = vi.fn();
    const container = mount(<ProfileLinksInput fieldName="profile.links" value={[]} onChange={onChange} />);

    await typeInto(urlField(container), "example.com/not-a-url");
    void act(() => addButton(container).click());

    // A blocking rejection interrupts; it does not wait politely behind
    // whatever the reader is doing.
    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toContain("must start with https:// or http://");
    // The value stays put so it can be corrected rather than retyped, and
    // nothing is reported to the form.
    expect(urlField(container).value).toBe("example.com/not-a-url");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wires the rejection to the control that caused it", async () => {
    const container = mount(<ProfileLinksInput fieldName="profile.links" value={[]} onChange={() => {}} />);

    const field = urlField(container);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.getAttribute("aria-describedby")).toBeNull();

    await typeInto(field, "ftp://example.com");
    void act(() => addButton(container).click());

    // The message is not merely near the input: the input points at it, so a
    // screen reader reads the reason when focus lands on the field again.
    expect(urlField(container).getAttribute("aria-invalid")).toBe("true");
    const describedBy = urlField(container).getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${describedBy!}"]`)?.getAttribute("role")).toBe("alert");
  });

  it("rejects a duplicate rather than silently dropping it", async () => {
    const onChange = vi.fn();
    const container = mount(
      <ProfileLinksInput fieldName="profile.links" value={["https://github.com/example"]} onChange={onChange} />,
    );

    await typeInto(urlField(container), "https://github.com/example");
    void act(() => addButton(container).click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already been added");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names the set of added links and every control that removes one", () => {
    const container = mount(
      <ProfileLinksInput
        fieldName="profile.links"
        value={["https://github.com/example", "https://orcid.org/0000"]}
        onChange={() => {}}
      />,
    );

    // A bare `aria-label` on a `<div>` is discarded, so the group needs a role
    // for its name to land on.
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Added profile links");

    // "Remove" three times over says nothing about which link goes; each
    // control names its own.
    const removeNames = [...container.querySelectorAll("button")]
      .map((button) => button.getAttribute("aria-label"))
      .filter((name): name is string => Boolean(name?.startsWith("Remove")));
    expect(removeNames).toEqual(["Remove GitHub", "Remove ORCID"]);
  });

  it("keeps serializing every link into the form, and reports a removal", () => {
    const onChange = vi.fn();
    const container = mount(
      <ProfileLinksInput
        fieldName="identity.links"
        value={["https://github.com/example", "https://orcid.org/0000"]}
        onChange={onChange}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((input) => [
        input.name,
        input.value,
      ]),
    ).toEqual([
      ["identity.links.0", "https://github.com/example"],
      ["identity.links.1", "https://orcid.org/0000"],
    ]);

    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove GitHub"]')!;
    void act(() => remove.click());
    expect(onChange).toHaveBeenCalledWith(["https://orcid.org/0000"]);
  });

  it("hides the add control once the cap is reached, without hiding what is already there", () => {
    const container = mount(
      <ProfileLinksInput
        fieldName="profile.links"
        max={2}
        value={["https://github.com/example", "https://orcid.org/0000"]}
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(container.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(2);
  });
});
