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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminHeadshotManager } from "../../assets/ts/shared/headshot/AdminHeadshotManager";
import { showHeadshotDisclaimer } from "../../assets/ts/shared/headshot/upload";
import { cropHeadshot } from "../../assets/ts/shared/headshot/crop";

// The two dialogs are Hugo-rendered <template> elements this environment has
// no copy of, and neither is what these tests are about: what matters here is
// that choosing a file reaches them at all.
vi.mock("../../assets/ts/shared/headshot/upload", () => ({
  showHeadshotDisclaimer: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../../assets/ts/shared/headshot/crop", () => ({
  cropHeadshot: vi.fn(() => Promise.resolve(new Blob(["cropped"], { type: "image/jpeg" }))),
}));

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

/**
 * Takes the file-choosing control the way a reader does: press the button,
 * and answer whatever input it opened with a file.
 *
 * The indirection is the point. The button opens a picker on the input its
 * `ref` holds, and the controller listens on the input it was handed — the
 * defect behind issue #28 was that those stopped being the same element, so a
 * test that reaches into the DOM for `input[type=file]` and fires `change` on
 * it passes while the surface is dead. This asks the button which input it
 * opened, and answers that one.
 *
 * No picker can open here, so `click()` announces itself with a bubbling event
 * instead. The announcement has to reach the document to be heard — which is
 * precisely what an orphaned input's events never do.
 */
const PICKER_OPENED = "test:file-picker-opened";

async function chooseFileThroughUploadButton(root: ParentNode, file: File): Promise<HTMLInputElement> {
  let opened: HTMLInputElement | null = null;
  const record = (event: Event) => {
    opened = event.target as HTMLInputElement;
  };
  document.addEventListener(PICKER_OPENED, record);
  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    this.dispatchEvent(new Event(PICKER_OPENED, { bubbles: true }));
  };
  try {
    await act(() => buttonNamed(root, "Upload headshot").click());
  } finally {
    HTMLInputElement.prototype.click = nativeClick;
    document.removeEventListener(PICKER_OPENED, record);
  }
  if (!opened) throw new Error("the upload button opened no file input attached to the document");
  const input = opened as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(showHeadshotDisclaimer).mockImplementation(() => Promise.resolve(true));
  vi.mocked(cropHeadshot).mockImplementation(() => Promise.resolve(new Blob(["cropped"], { type: "image/jpeg" })));
});

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
    expect(buttonNamed(container, "Upload headshot")).toBeInstanceOf(HTMLButtonElement);
    expect(buttonNamed(container, "Fetch from Gravatar")).toBeInstanceOf(HTMLButtonElement);
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

  it("starts the upload from the control the reader actually presses", async () => {
    const uploadHeadshot = vi.fn(() => Promise.resolve({ headshotUrl: "/media/ada.jpg" }));
    const onUploaded = vi.fn();
    const container = mount(
      <AdminHeadshotManager
        initialUrl={null}
        alt="Ada Lovelace"
        uploadHeadshot={uploadHeadshot}
        onUploaded={onUploaded}
      />,
    );

    const input = await chooseFileThroughUploadButton(
      container,
      new File(["photo"], "ada.jpg", { type: "image/jpeg" }),
    );

    // The input the button opened is the one the page shows. It used to be an
    // orphan the wiring had swapped out from under the ref (issue #28), so the
    // picker opened on a node no listener and no reader could reach.
    expect(input.isConnected).toBe(true);
    expect(input).toBe(container.querySelector('input[type="file"]'));

    // Terms first, then the crop, then the upload — in that order, because
    // the disclaimer not appearing was how the defect showed itself.
    expect(showHeadshotDisclaimer).toHaveBeenCalled();
    expect(cropHeadshot).toHaveBeenCalled();
    expect(uploadHeadshot).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith("/media/ada.jpg");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/ada.jpg");
  });

  it("still uploads after the surface re-renders around it", async () => {
    const uploadHeadshot = vi.fn(() => Promise.resolve({ headshotUrl: "/media/ada.jpg" }));
    const container = mount(
      <AdminHeadshotManager initialUrl={null} alt="Ada Lovelace" statusText="" uploadHeadshot={uploadHeadshot} />,
    );
    // Every render hands the manager new callback identities, so its wiring
    // effect runs again. Re-wiring must leave the same elements in place and
    // listening exactly once.
    void act(() =>
      render(
        <AdminHeadshotManager
          initialUrl={null}
          alt="Ada Lovelace"
          statusText="Looking up Gravatar…"
          uploadHeadshot={uploadHeadshot}
        />,
        container,
      ),
    );

    await chooseFileThroughUploadButton(container, new File(["photo"], "ada.jpg", { type: "image/jpeg" }));

    expect(uploadHeadshot).toHaveBeenCalledTimes(1);
  });

  it("declines a file the reader does not agree to publish", async () => {
    vi.mocked(showHeadshotDisclaimer).mockImplementation(() => Promise.resolve(false));
    const uploadHeadshot = vi.fn(() => Promise.resolve());
    const container = mount(
      <AdminHeadshotManager initialUrl={null} alt="Ada Lovelace" uploadHeadshot={uploadHeadshot} />,
    );

    await chooseFileThroughUploadButton(container, new File(["photo"], "ada.jpg", { type: "image/jpeg" }));

    expect(cropHeadshot).not.toHaveBeenCalled();
    expect(uploadHeadshot).not.toHaveBeenCalled();
  });

  it("reports a failed upload in the live region and to its caller", async () => {
    const onError = vi.fn();
    const container = mount(
      <AdminHeadshotManager
        initialUrl={null}
        alt="Ada Lovelace"
        uploadHeadshot={() => Promise.reject(new Error("Storage is unavailable."))}
        onError={onError}
      />,
    );

    await chooseFileThroughUploadButton(container, new File(["photo"], "ada.jpg", { type: "image/jpeg" }));

    expect(onError).toHaveBeenCalledWith("Storage is unavailable.");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Storage is unavailable.");
    // No photo is claimed for an upload that did not land.
    expect(container.querySelector("img")).toBeNull();
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
