import { FormFieldStatChart } from "../../assets/ts/components/forms/FormResponseStats";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { livePollResultsResponseSchema } from "../../assets/shared/schemas/live-session-poll-results";
import { LivePollResultsTable } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LivePollResultsTable";
import { LIVE_OCCURRENCE, LIVE_POLL, LIVE_POLL_FIELD, livePollResults } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});

describe("live poll results", () => {
  it("uses distinct reusable pie and donut presentations with identical canonical tally labels", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    void act(() =>
      render(
        <FormFieldStatChart
          field={LIVE_POLL_FIELD}
          stat={livePollResults({ "Root CA": 1, "TLS endpoints": 3 })}
          visualization="donut"
        />,
        host,
      ),
    );
    expect(host.querySelector(".adm-form-pie--donut")).not.toBeNull();
    expect(host.textContent).toContain("TLS endpoints(3)");
    void act(() =>
      render(
        <FormFieldStatChart
          field={LIVE_POLL_FIELD}
          stat={livePollResults({ "Root CA": 1, "TLS endpoints": 3 })}
          visualization="pie"
        />,
        host,
      ),
    );
    expect(host.querySelector(".adm-form-pie--solid")).not.toBeNull();
    expect(host.querySelectorAll("path.adm-form-pie-sector")).toHaveLength(2);
    expect(host.textContent).toContain("TLS endpoints(3)");
  });
  it("keeps all ten choices visible in compact legends, preserving full labels for inspection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const labels = Array.from({ length: 10 }, (_, index) => `Choice ${index} ${"long label ".repeat(40)}`);
    const stat = {
      fieldKey: LIVE_POLL_FIELD.key,
      totalAnswers: 10,
      uniqueAnswers: 10,
      entries: labels.map((label) => ({ label, count: 1, percent: 10, weight: 1 })),
    };
    void act(() => render(<FormFieldStatChart field={LIVE_POLL_FIELD} stat={stat} visualization="donut" />, host));
    expect(host.querySelectorAll(".adm-form-pie-legend-item")).toHaveLength(10);
    expect(host.querySelectorAll(".adm-form-pie-label")[9].getAttribute("title")).toBe(labels[9]);
    expect(host.querySelectorAll(".adm-form-pie-segment")).toHaveLength(10);
  });
  it("lists a session's copied polls from the server and charts each with the forms results chart", async () => {
    const body = livePollResultsResponseSchema.parse({
      polls: [
        {
          id: LIVE_POLL,
          field: LIVE_POLL_FIELD,
          status: "closed",
          showResults: true,
          results: livePollResults({ "Root CA": 1, "TLS endpoints": 3 }),
          createdAt: "2026-12-02T09:00:00.000Z",
          openedAt: "2026-12-02T09:05:00.000Z",
          closedAt: "2026-12-02T09:10:00.000Z",
        },
      ],
      page: { limit: 50, offset: 0, total: 1, hasMore: false },
    });
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    void act(() => render(<LivePollResultsTable slug="pqc-2026" occurrenceId={LIVE_OCCURRENCE} />, host));
    await settle();

    // The page asks the server for the list rather than filtering anything itself.
    expect(new URL(requests[0], "https://app.test").pathname).toBe(
      `/api/v1/events/pqc-2026/agenda/occurrences/${LIVE_OCCURRENCE}/live/polls`,
    );
    expect(host.textContent).toContain("Which migration comes first?");
    expect(host.textContent).toContain("Closed");
    expect(host.querySelector(".pk-chart")).not.toBeNull();
  });
});
