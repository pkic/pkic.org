// @vitest-environment jsdom
/**
 * The speaker's own photo on their portal speaker profile: the shared photo
 * tile, the speaker's own publication assertion, and the participation
 * headshot resource — not a round preview over full-width upload and remove
 * buttons.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParticipantSpeaker } from "../../assets/ts/components/events/ParticipantSpeaker";
import { speakerSelfServiceReadResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { OWN_HEADSHOT_DISCLAIMER, showHeadshotDisclaimer } from "../../assets/ts/shared/headshot/upload";

vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({ MarkdownEditor: () => null }));
vi.mock("../../assets/ts/shared/headshot/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/headshot/upload")>()),
  showHeadshotDisclaimer: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../../assets/ts/shared/headshot/crop", () => ({
  cropHeadshot: vi.fn(() => Promise.resolve(new Blob(["cropped"], { type: "image/jpeg" }))),
}));

const id = "00000000-0000-4000-8000-000000000041";

function speakerData(
  overrides: {
    headshotUrl?: string | null;
    proposalStatus?: "submitted" | "withdrawn";
    speakerStatus?: "invited" | "confirmed";
  } = {},
) {
  return speakerSelfServiceReadResponseSchema.parse({
    speaker: {
      userId: id,
      role: "speaker",
      status: overrides.speakerStatus ?? "invited",
      confirmedAt: overrides.speakerStatus === "confirmed" ? "2026-09-01T10:00:00.000Z" : null,
      declinedAt: null,
      termsAcceptedAt: null,
    },
    proposal: {
      id,
      title: "Speaker session",
      proposalType: "talk",
      status: overrides.proposalStatus ?? "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
      presentationUploader: null,
      coSpeakers: [],
      presentationUrl: null,
    },
    profile: {
      email: "ada@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      organizationName: null,
      jobTitle: null,
      biography: null,
      links: [],
      headshotUploaded: Boolean(overrides.headshotUrl),
      headshotUpdatedAt: null,
      headshotUrl: overrides.headshotUrl ?? null,
      actingIdentityId: null,
      actingIdentitySelectedAt: null,
      actingIdentitySelection: "unrecorded",
    },
    currentRepresentation: null,
    presentationTerms: [],
  });
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount(data: ReturnType<typeof speakerData>, reload = vi.fn(async () => {})) {
  await act(() => render(<ParticipantSpeaker data={data} eventSlug="pqc-2026" terms={[]} reload={reload} />, host));
}

it("makes the photo itself the control, named for the speaker, with no full-width buttons", async () => {
  await mount(speakerData());

  expect(host.querySelector('button[aria-label="Upload photo of Ada Lovelace"]')).not.toBeNull();
  const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
  expect(labels).not.toContain("Upload headshot");
  expect(labels).not.toContain("Remove headshot");
});

it("uploads through the speaker's own assertion and the participation headshot resource", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
      return Response.json({
        success: true,
        r2Key: "headshots/ada.jpg",
        headshotUrl: "https://example.test/headshots/ada.jpg",
      });
    }),
  );
  const reload = vi.fn(async () => {});
  await mount(speakerData(), reload);

  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["photo"], "ada.jpg", { type: "image/jpeg" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());

  expect(showHeadshotDisclaimer).toHaveBeenCalledWith(expect.objectContaining({ texts: OWN_HEADSHOT_DISCLAIMER }));
  const writes = requests.filter((request) => request.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0].method).toBe("PUT");
  expect(writes[0].url).toBe(`/api/v1/proposals/${id}/participation/headshot`);
  expect((writes[0].body as FormData).get("file")).toBeInstanceOf(Blob);
  expect(host.textContent).toContain("Photo uploaded");
});

it("shows the photo without any control once the proposal is closed", async () => {
  await mount(speakerData({ proposalStatus: "withdrawn", headshotUrl: "https://example.test/headshots/ada.jpg" }));

  expect(host.querySelector(`img[alt="Ada Lovelace's photo"]`)).not.toBeNull();
  expect(host.querySelector('button[aria-label$="photo of Ada Lovelace"]')).toBeNull();
});

it("opens the profile of a speaker who already confirmed", async () => {
  await mount(speakerData({ speakerStatus: "confirmed" }));

  expect(host.querySelector('button[aria-label="Upload photo of Ada Lovelace"]')).not.toBeNull();
});
