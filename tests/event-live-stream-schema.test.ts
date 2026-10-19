import { describe, expect, it } from "vitest";
import {
  locationLiveStreamUpdateSchema,
  locationStreamOn,
  youtubeStreamInputSchema,
} from "../assets/shared/schemas/event-live-stream";
import { calendarDatesBetween } from "../assets/shared/timezone";
import { youtubePrivacyEmbedUrl } from "../assets/shared/youtube-video";

const id = "jfKfPfyJRdk";

describe("YouTube live stream input", () => {
  it.each([
    id,
    ` ${id} `,
    `https://www.youtube.com/watch?v=${id}&t=30s`,
    `https://youtube.com/live/${id}?feature=share`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=tracking`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `www.youtube.com/live/${id}`,
  ])("keeps only the video ID from %s", (input) => {
    expect(youtubeStreamInputSchema.parse(input)).toBe(id);
  });

  it.each([
    "",
    "jfKfPfyJRd",
    "jfKfPfyJRdk1",
    "https://youtube.com.example.test/watch?v=jfKfPfyJRdk",
    "https://vimeo.com/123456",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/watch?v=short",
    "javascript:alert(1)",
    "jfKfPfyJ<k>",
  ])("refuses %s", (input) => {
    expect(youtubeStreamInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts its own output, so a form resubmitted after parsing keeps the same ID", () => {
    const once = locationLiveStreamUpdateSchema.parse({
      videoId: `https://youtu.be/${id}`,
      days: [{ dayDate: "2026-12-02", videoId: `https://www.youtube.com/live/${id}` }],
    });
    expect(locationLiveStreamUpdateSchema.parse(once)).toEqual({
      videoId: id,
      days: [{ dayDate: "2026-12-02", videoId: id }],
    });
  });

  it("refuses the same day twice", () => {
    expect(
      locationLiveStreamUpdateSchema.safeParse({
        videoId: null,
        days: [
          { dayDate: "2026-12-02", videoId: id },
          { dayDate: "2026-12-02", videoId: id },
        ],
      }).success,
    ).toBe(false);
  });

  it("embeds through the privacy-enhanced player only", () => {
    expect(youtubePrivacyEmbedUrl(id)).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/jfKfPfyJRdk\?/u);
  });
});

describe("the stream a location shows on a day", () => {
  const location = {
    stream: { provider: "youtube" as const, videoId: id },
    days: [{ dayDate: "2026-12-03", stream: { provider: "youtube" as const, videoId: "o-1sSF_xP5Q" } }],
  };
  it("uses the day's replacement and otherwise the usual stream", () => {
    expect(locationStreamOn(location, "2026-12-03")?.videoId).toBe("o-1sSF_xP5Q");
    expect(locationStreamOn(location, "2026-12-02")?.videoId).toBe(id);
    expect(locationStreamOn({ stream: null, days: location.days }, "2026-12-02")).toBeNull();
  });

  it("lists the event's calendar days in its own zone", () => {
    // 23:30 UTC on 30 November is already 1 December in Amsterdam.
    expect(calendarDatesBetween("2026-11-30T23:30:00.000Z", "2026-12-02T18:00:00.000Z", "Europe/Amsterdam")).toEqual([
      "2026-12-01",
      "2026-12-02",
    ]);
  });
});
