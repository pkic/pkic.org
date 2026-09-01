// @vitest-environment jsdom
/**
 * The shared headshot manager.
 *
 * Its three controls used to be a `<label class="btn">` wrapping a hidden
 * file input and two `<button class="btn btn-sm …">`, and its outcome was
 * written into a `<div class="mt-2 small text-muted">` with `textContent` —
 * a change no reader was ever told about. What is asserted here is the part
 * a visual specimen cannot show.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminHeadshotManager } from "../../assets/ts/shared/headshot/AdminHeadshotManager";

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

function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`no button reads "${label}"`);
  return match;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin headshot manager", () => {
  it("gives the controls one name each, groups them, and announces the outcome region", () => {
    const container = mount(
      <AdminHeadshotManager
        initialUrl={null}
        alt="Ada Lovelace"
        statusText="Ready"
        uploadHeadshot={() => Promise.resolve()}
        deleteHeadshot={() => Promise.resolve()}
        onFetchGravatar={() => undefined}
      />,
    );

    // The controls act on one thing, and the group says which one — a user
    // record can show more than one of these.
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Photo for Ada Lovelace");

    // One focusable control carrying one accessible name, rather than a label
    // wrapping an input a utility class had hidden.
    expect(buttonNamed(container, "📷 Upload headshot")).toBeInstanceOf(HTMLButtonElement);
    expect(buttonNamed(container, "🌐 Fetch from Gravatar")).toBeInstanceOf(HTMLButtonElement);
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(file?.hidden).toBe(true);

    // The controller writes the outcome here with `textContent`, which nobody
    // is told about unless the region announces itself.
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Ready");
  });

  it("keeps the remove control out of the way until there is a photo to remove", () => {
    const withoutPhoto = mount(
      <AdminHeadshotManager
        initialUrl={null}
        alt="Ada Lovelace"
        uploadHeadshot={() => Promise.resolve()}
        deleteHeadshot={() => Promise.resolve()}
      />,
    );
    expect(withoutPhoto.querySelector<HTMLButtonElement>("[data-headshot-delete]")?.hidden).toBe(true);

    const withPhoto = mount(
      <AdminHeadshotManager
        initialUrl="/media/ada.jpg"
        alt="Ada Lovelace"
        uploadHeadshot={() => Promise.resolve()}
        deleteHeadshot={() => Promise.resolve()}
      />,
    );
    expect(withPhoto.querySelector<HTMLButtonElement>("[data-headshot-delete]")?.hidden).toBe(false);
    expect(withPhoto.querySelector("img")?.getAttribute("alt")).toBe("Ada Lovelace");
  });

  it("offers no controls at all in read-only mode", () => {
    const container = mount(
      <AdminHeadshotManager
        initialUrl="/media/ada.jpg"
        alt="Ada Lovelace"
        readOnly
        uploadHeadshot={() => Promise.resolve()}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("reports a failed removal in the live region and to its caller", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const onError = vi.fn();
    const container = mount(
      <AdminHeadshotManager
        initialUrl="/media/ada.jpg"
        alt="Ada Lovelace"
        uploadHeadshot={() => Promise.resolve()}
        deleteHeadshot={() => Promise.reject(new Error("Storage is unavailable."))}
        onError={onError}
      />,
    );

    const remove = container.querySelector<HTMLButtonElement>("[data-headshot-delete]")!;
    await act(() => remove.click());
    await settle();

    // `AdminHeadshotManager` narrows the controller's (message, action) pair
    // to the message its callers actually surface.
    expect(onError).toHaveBeenCalledWith("Storage is unavailable.");
    // The failure lands in the region that announces itself, not only in a
    // console the reader never sees.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Storage is unavailable.");
    // The photo is still there, so the surface does not claim a removal that
    // did not happen.
    expect(container.querySelector("img")).not.toBeNull();
  });
});
