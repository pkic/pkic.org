// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  locationLiveStreamResponseSchema,
  locationLiveStreamUpdateSchema,
} from "../../assets/shared/schemas/event-live-stream";
import { LocationLiveStreamEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/LocationLiveStreamEditor";

const ROOM = "a0000000-0000-4000-8000-000000000001";
const VIDEO = "jfKfPfyJRdk";
const DAY_TWO = "o-1sSF_xP5Q";
const empty = locationLiveStreamResponseSchema.parse({
  roomId: ROOM,
  roomName: "Main hall",
  stream: null,
  days: [],
  eventDays: ["2027-01-20", "2027-01-21"],
  timeZone: "Europe/Amsterdam",
});

let host: HTMLDivElement;
const sent: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return Response.json(empty);
      const body = locationLiveStreamUpdateSchema.parse(JSON.parse(String(init.body)));
      sent.push(body);
      return Response.json(
        locationLiveStreamResponseSchema.parse({
          ...empty,
          stream: body.videoId ? { provider: "youtube", videoId: body.videoId } : null,
          days: body.days.map((day) => ({
            dayDate: day.dayDate,
            stream: { provider: "youtube", videoId: day.videoId },
          })),
        }),
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let round = 0; round < 5; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function type(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("location live stream editor", () => {
  it("accepts a pasted YouTube link and a day's replacement, and sends only the video IDs", async () => {
    await act(async () => {
      render(<LocationLiveStreamEditor slug="summit" roomId={ROOM} />, host);
    });
    await settle();
    await act(async () => type("videoId", `https://www.youtube.com/live/${VIDEO}?si=share`));
    await act(async () => type("day-2027-01-21", `https://youtu.be/${DAY_TWO}`));
    await act(async () => host.querySelector("form")!.requestSubmit());
    await settle();
    expect(sent).toEqual([{ videoId: VIDEO, days: [{ dayDate: "2027-01-21", videoId: DAY_TWO }] }]);
    expect(host.querySelector<HTMLInputElement>('input[name="videoId"]')?.value).toBe(VIDEO);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Saved");
  });

  it("refuses an address that is not a YouTube video on the field, without sending it", async () => {
    await act(async () => {
      render(<LocationLiveStreamEditor slug="summit" roomId={ROOM} />, host);
    });
    await settle();
    await act(async () => type("videoId", "https://vimeo.com/123456"));
    await act(async () => host.querySelector("form")!.requestSubmit());
    await settle();
    expect(sent).toEqual([]);
    expect(host.querySelector('input[name="videoId"]')?.getAttribute("aria-invalid")).toBe("true");
  });
});
