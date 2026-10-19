// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { Markdown } from "../../assets/ts/ui/Markdown";
import { markdownVideoEmbed, youtubeVideoEmbed } from "../../assets/shared/markdown-media";

let host: HTMLElement | undefined;
afterEach(() => {
  if (!host) return;
  void act(() => render(null, host!));
  host.remove();
  host = undefined;
});

// Exact authored Ottawa recording offsets: one long video addresses ten sessions.
const authoredStarts = [1499, 2132, 5713, 8338, 10682, 16437, 18196, 19903, 21092, 23574];
describe("approved recording start offsets", () => {
  it.each(authoredStarts)("preserves the authored %i-second start in the shared session iframe", async (start) => {
    const recordingUrl = `https://www.youtube.com/watch?v=o-1sSF_xP5Q&start=${start}`;
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <AgendaSession
          session={{
            title: "Approved historical recording",
            descriptionHtml: "Historical abstract",
            locations: [],
            speakers: [],
            recordingUrl,
            recordingApproved: true,
            endNotRecorded: true,
          }}
          slot={{ startsAt: "2023-03-03T14:30:00.000Z" }}
          locations={[]}
          dialogId="recording-offset"
          timeZone="America/Toronto"
        />,
        host!,
      ),
    );
    expect(host.querySelector("iframe")?.getAttribute("data-video-src")).toBe(
      `https://www.youtube-nocookie.com/embed/o-1sSF_xP5Q?start=${start}`,
    );
    expect(host.querySelector("iframe")?.hasAttribute("src")).toBe(false);
    expect([...host.querySelectorAll("a")].some((link) => link.getAttribute("href") === recordingUrl)).toBe(true);
  });

  it("uses the same canonical offset in the Markdown iframe", async () => {
    const url = "https://www.youtube.com/watch?v=o-1sSF_xP5Q&start=1499";
    host = document.createElement("div");
    await act(() => render(<Markdown markdown={url} />, host!));
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/o-1sSF_xP5Q?start=1499",
    );
    expect(markdownVideoEmbed(`[Recording](${url})`)).toBe(youtubeVideoEmbed(url));
  });

  it.each(["0", "9999999999"])("preserves the existing bounded start %s", (start) => {
    expect(youtubeVideoEmbed(`https://youtu.be/o-1sSF_xP5Q?start=${start}`)).toBe(
      `https://www.youtube.com/embed/o-1sSF_xP5Q?start=${start}`,
    );
  });

  it.each(["", "-1", "01", "1.5", "1e3", "10000000000", "1499<script>"])(
    "refuses an invalid authored start %s",
    (start) => {
      const url = `https://www.youtube.com/watch?v=o-1sSF_xP5Q&start=${encodeURIComponent(start)}`;
      expect(youtubeVideoEmbed(url)).toBeNull();
      expect(markdownVideoEmbed(url)).toBeNull();
    },
  );

  it.each([
    "javascript:alert(1)",
    "https://youtube.com.example.test/watch?v=o-1sSF_xP5Q&start=1499",
    "https://example.test/watch?v=o-1sSF_xP5Q&start=1499",
    "https://youtube.com/channel/o-1sSF_xP5Q?start=1499",
  ])("keeps an unrelated destination out of the YouTube embed %s", (url) => {
    expect(youtubeVideoEmbed(url)).toBeNull();
  });
});
