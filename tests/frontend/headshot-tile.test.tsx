// @vitest-environment jsdom
/**
 * The shared headshot tile: the photo is the control, and every photograph of
 * a person passes the same consent and square crop before it is stored,
 * whichever resource stores it.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { HeadshotTile, type HeadshotTileProps } from "../../assets/ts/shared/headshot/HeadshotTile";
import {
  ADMIN_HEADSHOT_DISCLAIMER,
  OWN_HEADSHOT_DISCLAIMER,
  showHeadshotDisclaimer,
} from "../../assets/ts/shared/headshot/upload";
import { cropHeadshot } from "../../assets/ts/shared/headshot/crop";

// The two dialogs are page-rendered <template> elements this environment has
// no copy of, and neither is what these tests are about: what matters here is
// that choosing a file reaches them, in order, and what follows their answer.
vi.mock("../../assets/ts/shared/headshot/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/headshot/upload")>()),
  showHeadshotDisclaimer: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../../assets/ts/shared/headshot/crop", () => ({
  cropHeadshot: vi.fn(() => Promise.resolve(new Blob(["cropped"], { type: "image/jpeg" }))),
}));

const CROPPED = new Blob(["cropped"], { type: "image/jpeg" });
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

function named(root: ParentNode, name: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!button) throw new Error(`no control is named "${name}"`);
  return button;
}

function tile(overrides: Partial<HeadshotTileProps> = {}): HeadshotTileProps {
  return {
    name: "Ada Lovelace",
    imageUrl: null,
    canChange: true,
    consent: "on-behalf",
    endpoint: { upload: vi.fn(() => Promise.resolve("/media/ada.jpg")), remove: vi.fn(() => Promise.resolve()) },
    onChanged: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

/**
 * Takes the file-choosing control the way a reader does: press the photo,
 * and answer whatever input it opened with a file.
 *
 * No picker can open here, so `click()` announces itself with a bubbling
 * event instead; an input detached from the document is never heard, which
 * is the defect behind issue #28.
 */
const PICKER_OPENED = "test:file-picker-opened";

async function chooseFileThroughPhoto(root: ParentNode, control: string, file: File): Promise<void> {
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
    await act(() => named(root, control).click());
  } finally {
    HTMLInputElement.prototype.click = nativeClick;
    document.removeEventListener(PICKER_OPENED, record);
  }
  if (!opened) throw new Error("the photo opened no file input attached to the document");
  const input = opened as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

const photo = () => new File(["photo"], "ada.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(showHeadshotDisclaimer).mockImplementation(() => Promise.resolve(true));
  vi.mocked(cropHeadshot).mockImplementation(() => Promise.resolve(CROPPED));
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("headshot tile", () => {
  it("is the control, named for the person, with no command buttons beside it", () => {
    const empty = mount(<HeadshotTile {...tile()} />);
    const upload = named(empty, "Upload photo of Ada Lovelace");
    expect(empty.querySelector(`#${upload.getAttribute("aria-describedby")!}`)?.textContent).toBe("JPEG, PNG or WebP.");
    expect(empty.querySelector('button[aria-label^="Remove"]')).toBeNull();

    const pictured = mount(<HeadshotTile {...tile({ imageUrl: "/media/ada.jpg" })} />);
    expect(named(pictured, "Change photo of Ada Lovelace").querySelector("img")?.getAttribute("alt")).toBe(
      "Ada Lovelace's photo",
    );
    // The removal is the small corner control, not a full-width button.
    expect(named(pictured, "Remove photo of Ada Lovelace").textContent).toBe("×");
    expect(pictured.querySelector(".pk-picture-tile--round")).not.toBeNull();
  });

  it("shows a read-only reader the photo, or initials that say there is none", () => {
    const pictured = mount(<HeadshotTile {...tile({ canChange: false, imageUrl: "/media/ada.jpg" })} />);
    expect(pictured.querySelectorAll("button")).toHaveLength(0);
    expect(pictured.querySelector('input[type="file"]')).toBeNull();
    expect(pictured.querySelector("img")?.getAttribute("alt")).toBe("Ada Lovelace's photo");

    const empty = mount(<HeadshotTile {...tile({ canChange: false })} />);
    expect(empty.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Ada Lovelace has no photo");
  });

  it("asks for consent, crops square, then stores the crop and reports the stored photo", async () => {
    const props = tile();
    const container = mount(<HeadshotTile {...props} />);

    // The input the photo opened is the one listening: the upload that
    // follows is the proof, since an orphaned input reaches nothing (#28).
    await chooseFileThroughPhoto(container, "Upload photo of Ada Lovelace", photo());

    expect(showHeadshotDisclaimer).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Before uploading a photo", texts: ADMIN_HEADSHOT_DISCLAIMER }),
    );
    expect(cropHeadshot).toHaveBeenCalled();
    expect(props.endpoint.upload).toHaveBeenCalledWith(CROPPED);
    expect(props.notify).toHaveBeenCalledWith("Photo uploaded", "success");
    expect(props.onChanged).toHaveBeenCalledWith("/media/ada.jpg");
  });

  it("asks the person pictured for their own assertion, not the one made on somebody's behalf", async () => {
    const container = mount(<HeadshotTile {...tile({ consent: "own", self: true })} />);

    await chooseFileThroughPhoto(container, "Upload photo of Ada Lovelace", photo());

    expect(showHeadshotDisclaimer).toHaveBeenCalledWith(expect.objectContaining({ texts: OWN_HEADSHOT_DISCLAIMER }));
  });

  it("stores nothing and reports nothing when the reader declines the terms", async () => {
    vi.mocked(showHeadshotDisclaimer).mockImplementation(() => Promise.resolve(false));
    const props = tile();
    const container = mount(<HeadshotTile {...props} />);

    await chooseFileThroughPhoto(container, "Upload photo of Ada Lovelace", photo());

    expect(cropHeadshot).not.toHaveBeenCalled();
    expect(props.endpoint.upload).not.toHaveBeenCalled();
    expect(props.notify).not.toHaveBeenCalled();
  });

  it("refuses an oversized original before asking anything", async () => {
    const props = tile();
    const container = mount(<HeadshotTile {...props} />);
    const huge = photo();
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });

    await chooseFileThroughPhoto(container, "Upload photo of Ada Lovelace", huge);

    expect(showHeadshotDisclaimer).not.toHaveBeenCalled();
    expect(props.notify).toHaveBeenCalledWith("Please choose an image under 20 MB.", "error");
  });

  it("states a failed upload as a sentence rather than a transport status", async () => {
    const failing = new ApiClientError({ error: { code: "HTTP_ERROR", message: "HTTP 500" } }, 500);
    const props = tile({ endpoint: { upload: () => Promise.reject(failing), remove: () => Promise.resolve() } });
    const container = mount(<HeadshotTile {...props} />);

    await chooseFileThroughPhoto(container, "Upload photo of Ada Lovelace", photo());

    const [message, type] = vi.mocked(props.notify).mock.calls[0];
    expect(type).toBe("error");
    expect(message).not.toBe("HTTP 500");
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("removes the photo only after the reader confirms, addressing them when it is their own", async () => {
    const props = tile({ imageUrl: "/media/ada.jpg", self: true });
    const container = mount(
      <>
        <ConfirmDialogHost />
        <HeadshotTile {...props} />
      </>,
    );

    await act(() => named(container, "Remove photo of Ada Lovelace").click());
    const dialog = container.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Remove your photo?");
    expect(props.endpoint.remove).not.toHaveBeenCalled();

    const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Remove photo")!;
    await act(() => confirm.click());
    await settle();

    expect(props.endpoint.remove).toHaveBeenCalledTimes(1);
    expect(props.notify).toHaveBeenCalledWith("Photo removed", "success");
    expect(props.onChanged).toHaveBeenCalledWith(null);
  });
});
