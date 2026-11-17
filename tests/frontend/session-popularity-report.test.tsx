// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { SessionPopularityReport } from "../../assets/ts/member-flows/portal/sections/events/detail/SessionPopularityReport";
import {
  sessionPopularityReportQuerySchema,
  sessionPopularityReportResponseSchema,
} from "../../assets/shared/schemas/event-session-popularity-report";

let host: HTMLDivElement | null = null;
afterEach(() => {
  if (host) {
    void act(() => render(null, host!));
    host.remove();
    host = null;
  }
  vi.unstubAllGlobals();
});

const payload = sessionPopularityReportResponseSchema.parse({
  sessions: [
    {
      occurrenceId: "10000000-0000-4000-8000-000000000001",
      title: "Keynote: the road ahead",
      startAt: "2030-01-01T09:00:00.000Z",
      reactions: [
        { reaction: "applause", total: 1240 },
        { reaction: "love", total: 5 },
        { reaction: "laugh", total: 0 },
        { reaction: "mind_blown", total: 3 },
        { reaction: "thumbs_up", total: 10 },
      ],
      reactionTotal: 1258,
      chatMessages: 312,
      chatPeople: 48,
      questions: 4,
      questionVotes: 31,
      pollAnswers: 87,
    },
  ],
  page: { limit: 50, offset: 0, total: 1, hasMore: false },
  timeZone: "Europe/Amsterdam",
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("shows each session's interactions from the server, most reactions first, and sorts on the server", async () => {
  const queries: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      expect(url.pathname).toBe("/api/v1/events/event-one/agenda/reports/popularity");
      queries.push(sessionPopularityReportQuerySchema.parse(Object.fromEntries(url.searchParams)));
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<SessionPopularityReport slug="event-one" />, host!);
  });
  await vi.waitFor(async () => {
    await settle();
    expect(host?.querySelector("tbody")?.textContent).toContain("Keynote: the road ahead");
  });
  expect(queries[0]).toMatchObject({ sort: "-reactionTotal" });
  const cells = [...host.querySelectorAll("tbody td")].map((cell) => cell.textContent?.trim());
  expect(cells).toEqual(
    expect.arrayContaining([
      "Reactions1,258👏 1,240 · ❤️ 5 · 🤯 3 · 👍 10",
      "Chat messages312from 48 people",
      "Questions4",
      "Question votes31",
      "Poll answers87",
    ]),
  );
  const heads = [...host.querySelectorAll("thead th")].map((cell) => cell.textContent);
  expect(heads.join(" ")).not.toContain("Applause");
  expect(heads.join(" ")).toContain("Poll answers");
  const questionsSort = [...host.querySelectorAll<HTMLButtonElement>("thead button")].find((button) =>
    button.textContent?.includes("Questions"),
  );
  expect(questionsSort).toBeDefined();
  await act(async () => questionsSort!.click());
  await vi.waitFor(async () => {
    await settle();
    expect(queries.at(-1)).toMatchObject({ sort: expect.stringMatching(/^-?questions$/) });
  });
});

it("explains when no session has any interaction yet", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...payload, sessions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<SessionPopularityReport slug="event-one" />, host!);
  });
  await vi.waitFor(async () => {
    await settle();
    expect(host?.textContent).toContain("No session has reactions, chat messages, questions, or poll answers yet.");
  });
});
