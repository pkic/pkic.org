import { afterEach, expect, it, vi } from "vitest";
import { createEventsIndex } from "../functions/_lib/services/site-events";
import type { ContentDocument } from "../functions/_lib/services/site-documents";
import { withinUpcomingEventWindow } from "../assets/shared/event-phase";

afterEach(() => vi.useRealTimers());

it.each(["conference", "webinar"])(
  "uses the %s start rather than its announcement date on public event cards",
  async (eventType) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T12:00:00.000Z"));
    const document: ContentDocument = {
      body: "",
      data: {
        title: "Synthetic conference",
        date: "2026-02-24T08:00:00Z",
        params: { eventDate: "2026-12-01T00:00:00Z", eventType },
      },
      isSection: false,
      language: "en",
      nodePath: "events/conference",
      route: "/events/conference/",
      sourcePath: "content/events/conference/_index.md",
    };
    const index = await createEventsIndex({
      documents: [document],
      inlineMarkdownHtml: async (value) => value,
      parseYaml: () => ({}),
      listingItem: (item) => ({ href: item.route, title: String(item.data.title), date: String(item.data.date) }),
    })("");
    const item = eventType === "conference" ? index.upcoming[0]?.events[0] : index.webinars.upcoming[0];
    expect(item?.date).toBe(document.data.params?.eventDate);
    expect(withinUpcomingEventWindow(item?.date)).toBe(true);
  },
);
