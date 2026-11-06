import { cropImage } from "../../assets/ts/shared/headshot/crop";
// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventHeroImageFormSchema, eventHeroImageSaveSchema } from "../../assets/shared/schemas/event-hero-image";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { GeneralTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/GeneralTab";
import { cleanup, json, mount, responseEvent } from "./helpers/event-management";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, typeInto } from "./helpers/labeled-control";

vi.mock("../../assets/ts/shared/headshot/crop", () => ({ cropImage: vi.fn(async (file: File) => file) }));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const writableEvent = eventDetailSchema.parse({
  ...responseEvent,
  registrationPath: null,
  ownerGroupId: null,
  capabilities: ["read", "write", "manage"],
  sourceMode: "integration",
  seriesId: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  sessionTypes: null,
  settings: {},
});
async function submitForm(container: HTMLElement) {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function heroPreview(container: HTMLElement) {
  return vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const preview = container.querySelector<HTMLImageElement>('img[alt="Event hero preview"]');
    if (!preview) throw new Error("Image preview is not ready");
    return preview;
  });
}

describe("event hero image selection", () => {
  it("uploads the selected image with validated general settings in one save", async () => {
    const updated = vi.fn();
    const responseEvent = {
      ...writableEvent,
      heroImageUrl: "/api/v1/events/portal-workshop/images/00000000-0000-4000-8000-000000000000.png",
    };
    const fetcher = vi.fn(async () => json({ event: responseEvent }));
    vi.stubGlobal("fetch", fetcher);
    const container = mount(<GeneralTab event={writableEvent} onUpdated={updated} />);
    await beginRecordEdit(container, "Event settings actions");
    const file = new File(["image bytes"], "hero.png", { type: "image/png" });
    const input = container.querySelector<HTMLInputElement>('input[name="file"]')!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const preview = await heroPreview(container);
    expect(preview.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
    Object.defineProperties(preview, { naturalWidth: { value: 1200 }, naturalHeight: { value: 675 } });
    await act(async () => {
      preview.dispatchEvent(new Event("load"));
    });
    expect(fetcher).not.toHaveBeenCalled();
    await submitForm(container);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [address, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = eventHeroImageSaveSchema.parse(
      Object.fromEntries(new URL(address, "https://app.test").searchParams),
    );
    expect(parsed.name).toBe(writableEvent.name);
    expect(parsed.expectedUpdatedAt).toBe(writableEvent.updatedAt);
    expect(init.method).toBe("POST");
    const uploaded = eventHeroImageFormSchema.shape.file.parse(init.body);
    expect(uploaded.type).toBe("image/jpeg");
    expect(updated).toHaveBeenCalled();
  });

  it.each(["image/svg+xml", "image/png"])(
    "rejects unsupported files or proportions through the shared contract (%s)",
    async (mime) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const container = mount(<GeneralTab event={writableEvent} onUpdated={vi.fn()} />);
      await beginRecordEdit(container, "Event settings actions");
      const input = container.querySelector<HTMLInputElement>('input[name="file"]')!;
      Object.defineProperty(input, "files", { value: [new File(["invalid image"], "hero", { type: mime })] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      if (mime === "image/png") {
        const preview = await heroPreview(container);
        Object.defineProperties(preview, { naturalWidth: { value: 1200 }, naturalHeight: { value: 1200 } });
        await act(async () => {
          preview.dispatchEvent(new Event("load"));
        });
      }
      if (mime === "image/svg+xml") {
        expect(cropImage).not.toHaveBeenCalled();
        return;
      }
      await submitForm(container);
      expect(container.querySelector('button[aria-label*="hero image"]')?.getAttribute("aria-invalid")).toBe("true");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

it("offers an image address as an alternative and saves it without uploading a file", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({ event: writableEvent }));
  vi.stubGlobal("fetch", fetcher);
  const container = mount(<GeneralTab event={writableEvent} onUpdated={vi.fn()} />);
  await beginRecordEdit(container, "Event settings actions");
  expect(container.querySelector('input[name="heroImageUrl"]')).toBeNull();
  const fileInput = container.querySelector<HTMLInputElement>('input[name="file"]')!;
  Object.defineProperty(fileInput, "files", {
    value: [new File(["pending image"], "hero.png", { type: "image/png" })],
  });
  await act(async () => {
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const addressChoice = controlFor(container, "Use image address") as HTMLInputElement;
  await act(async () => {
    addressChoice.click();
  });
  expect(container.querySelector('input[type="file"]')).toBeNull();
  await typeInto(controlFor(container, "Image address"), "/images/conference.png");
  await submitForm(container);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toContain("/settings");
  expect(eventSettingsUpdateSchema.parse(JSON.parse(String(init?.body))).heroImageUrl).toBe("/images/conference.png");
});

it("keeps the saved image when the crop is canceled", async () => {
  vi.mocked(cropImage).mockResolvedValueOnce(null);
  const container = mount(
    <GeneralTab event={{ ...writableEvent, heroImageUrl: "/images/saved.jpg" }} onUpdated={vi.fn()} />,
  );
  await beginRecordEdit(container, "Event settings actions");
  const input = container.querySelector<HTMLInputElement>('input[name="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["image"], "source.png", { type: "image/png" })] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector('img[alt="Event hero preview"]')?.getAttribute("src")).toBe("/images/saved.jpg");
});

it("does not restore an image removed while a crop is pending", async () => {
  let finishCrop!: (value: Blob | null) => void;
  const pendingCrop = new Promise<Blob | null>((resolve) => {
    finishCrop = resolve;
  });
  vi.mocked(cropImage).mockReturnValueOnce(pendingCrop);
  const container = mount(
    <GeneralTab event={{ ...writableEvent, heroImageUrl: "/images/saved.jpg" }} onUpdated={vi.fn()} />,
  );
  await beginRecordEdit(container, "Event settings actions");
  const input = container.querySelector<HTMLInputElement>('input[name="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["source"], "header.png", { type: "image/png" })] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(cropImage).toHaveBeenCalledTimes(1);
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove hero image of this event"]')!.click();
  });
  await act(async () => {
    finishCrop(new Blob(["cropped"], { type: "image/jpeg" }));
  });
  expect(container.querySelector('img[alt="Event hero preview"]')).toBeNull();
});
