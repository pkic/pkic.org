// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { runRowAction } from "./helpers/row-actions";
const occurrenceId = crypto.randomUUID();
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "review-event",
  timeZone: "UTC",
  revision: 7,
  publishedRevision: 6,
  rooms: [{ id: "room", name: "Main hall", capacity: 80 }],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: occurrenceId,
      title: "Historical workshop",
      description: "",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: null,
      speakers: [],
    },
  ],
});
const request = {
  id: crypto.randomUUID(),
  occurrenceId,
  appearance: {
    userId: crypto.randomUUID(),
    actingIdentityId: null,
    displayName: "Historical speaker",
    organizationName: "Historical organization",
    jobTitle: "Engineer",
    biography: "Archive biography",
    photoUrl: null,
    approvedAt: "2026-01-01T00:00:00.000Z",
  },
  reason: "Correct the historical employer",
  evidence: "Archived conference program confirms this employer",
  requestedBy: crypto.randomUUID(),
  requestedAt: "2026-10-01T00:00:00.000Z",
  decision: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
};
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(canReviewAppearances: boolean) {
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return json({ agenda: { ...snapshot, revision: 8 }, override: { ...request, decision: "approved" } });
    return json(
      String(url).includes("appearance-overrides")
        ? { overrides: [request], canReview: true, page: { limit: 50, offset: 0, total: 1, hasMore: false } }
        : snapshot,
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await act(() =>
    render(<AgendaEditor slug="review-event" canEdit={false} canReviewAppearances={canReviewAppearances} />, host),
  );
  await settle();
  return fetcher;
}
describe("independent historical representation reviewer", () => {
  it("opens review without write controls or archive request fields and records a decision", async () => {
    const fetcher = await mount(true);
    expect(host.querySelector("article[draggable='true']")).toBeNull();
    expect(host.textContent).not.toContain("New session");
    expect(host.textContent).not.toContain("Approve for publication");
    await runRowAction(host, "Historical workshop", "Review historical representation");
    await settle();
    expect(host.textContent).not.toContain("Save archive details");
    expect(host.textContent).not.toContain("Request independent review");
    expect(host.querySelector("textarea[name='evidence']")).toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Session archive actions"]')!.click());
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Historical representation overrides")!
        .click();
    });
    await settle();
    expect(host.querySelector("form")).toBeNull();
    const review = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Review override",
    )!;
    expect(review).toBeDefined();
    await act(async () => {
      review.click();
    });
    await settle();
    expect(host.querySelector("table")).toBeNull();
    const reason = host.querySelector<HTMLTextAreaElement>("textarea[name='reason']")!;
    await act(() => {
      reason.value = "Verified against the archived program";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Close")!.click();
    });
    await settle();
    expect(host.textContent).not.toContain("Draft revision");
    await runRowAction(host, "Agenda", "Review for publication");
    await settle();
    expect(host.querySelector("dt")?.textContent).toBe("Draft revision");
    expect(host.querySelector("dd")?.textContent).toBe("8");
    expect(host.textContent).not.toContain("Approve for publication");
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toContain(`/${request.id}/decisions`);
    expect(JSON.parse(String(posts[0]![1]?.body))).toMatchObject({
      expectedRevision: 7,
      decision: "approved",
      reason: "Verified against the archived program",
    });
  });
  it("does not offer review controls to an ordinary agenda reader", async () => {
    const fetcher = await mount(false);
    expect(host.textContent).not.toContain("Review historical representation");
    const menu = host.querySelector<HTMLButtonElement>('[aria-label="Actions for Agenda"]');
    expect(menu).not.toBeNull();
    await act(() => menu!.click());
    expect(host.textContent).toContain("Public preview");
    expect(host.textContent).toContain("Review for publication");
    expect(host.textContent).not.toContain("New location");
    expect(host.textContent).not.toContain("Import sessions");
    expect(host.textContent).not.toContain("Review historical representation");
    expect(host.textContent).not.toContain("Approve for publication");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("appearance-overrides"))).toBe(false);
  });
});
