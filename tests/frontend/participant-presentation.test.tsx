// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParticipantPresentation } from "../../assets/ts/components/events/ParticipantPresentation";
import { participantSpeakerFixture } from "./helpers/participant-speaker-fixture";
import { showHeadshotDisclaimer } from "../../assets/ts/shared/headshot/upload";

vi.mock("../../assets/ts/shared/headshot/upload", () => ({ showHeadshotDisclaimer: vi.fn(async () => true) }));
let host: HTMLDivElement;
beforeEach(() => {
  vi.mocked(showHeadshotDisclaimer).mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
function acceptedSpeaker() {
  const data = participantSpeakerFixture();
  data.proposal.status = "accepted";
  data.speaker.status = "confirmed";
  return data;
}

it.each(["submitted", "declined"] as const)("withholds presentation controls while %s", async (state) => {
  const data = acceptedSpeaker();
  if (state === "submitted") data.proposal.status = state;
  else data.speaker.status = state;
  await act(() => render(<ParticipantPresentation data={data} reload={async () => {}} />, host));
  expect(host.textContent).toContain(
    "Presentations are available after the proposal is accepted and your participation is confirmed.",
  );
  expect(host.querySelector('input[type="file"]')).toBeNull();
});

it("keeps the current download available after the upload deadline", async () => {
  const data = acceptedSpeaker();
  data.proposal.presentationUploaded = true;
  data.proposal.presentationDeadline = "2000-01-01T00:00:00.000Z";
  await act(() => render(<ParticipantPresentation data={data} reload={async () => {}} />, host));
  expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
  expect(host.textContent).toContain("The presentation upload deadline has passed.");
  expect(host.querySelector('a[aria-label="Download current presentation"]')?.getAttribute("href")).toBe(
    `/api/v1/proposals/${data.proposal.id}/participation/presentation`,
  );
});

it("shows a server refusal and releases the upload control for another attempt", async () => {
  const data = acceptedSpeaker();
  const reload = vi.fn(async () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "UPLOAD_REFUSED",
            message: "Upload refused.",
            details: { formErrors: ["Presentation storage is unavailable."] },
          },
        },
        { status: 503 },
      ),
    ),
  );
  await act(() => render(<ParticipantPresentation data={data} reload={reload} />, host));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["%PDF-1.4"], "slides.pdf", { type: "application/pdf" })] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Presentation storage is unavailable."));
  expect(input.disabled).toBe(false);
  expect(host.textContent).not.toContain("slides.pdf");
  expect(reload).not.toHaveBeenCalled();
});

it.each([false, true])(
  "clears the picker after disclaimer acceptance is %s, allowing the same file again",
  async (accepted) => {
    vi.mocked(showHeadshotDisclaimer).mockResolvedValue(accepted);
    const fetcher = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    const reload = vi.fn(async () => {});
    await act(() => render(<ParticipantPresentation data={acceptedSpeaker()} reload={reload} />, host));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const setter = vi.spyOn(input, "value", "set");
    for (let attempt = 0; attempt < 2; attempt++) {
      Object.defineProperty(input, "files", {
        value: [new File(["%PDF-1.4"], "slides.pdf", { type: "application/pdf" })],
        configurable: true,
      });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await vi.waitFor(() => expect(setter).toHaveBeenCalledTimes(attempt + 1));
      expect(setter).toHaveBeenLastCalledWith("");
      expect(input.disabled).toBe(false);
      expect(host.textContent).not.toContain("slides.pdf");
    }
    expect(fetcher).toHaveBeenCalledTimes(accepted ? 2 : 0);
    expect(reload).toHaveBeenCalledTimes(accepted ? 2 : 0);
  },
);
