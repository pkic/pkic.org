// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { UserParticipationHistory } from "../../assets/ts/member-flows/portal/sections/system-users/UserParticipationHistory";
vi.mock("../../assets/ts/components/ApiDataTable", () => ({
  ApiDataTable: ({ endpoint }: { endpoint: string }) => <div data-endpoint={endpoint} />,
}));
const userId = "10000000-0000-4000-8000-000000000001";
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  history.replaceState(null, "", "/portal/#/");
});
it.each(["events", "meetings", "documents", "votes"])(
  "loads %s from the user's participation collection",
  async (collection) => {
    history.replaceState(null, "", `/portal/#/users/${userId}${collection === "events" ? "" : `/${collection}`}`);
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<UserParticipationHistory userId={userId} canRead />, host!));
    expect(host.querySelector("[data-endpoint]")?.getAttribute("data-endpoint")).toBe(
      `/api/v1/users/${userId}/participation/${collection}`,
    );
  },
);
it("restores the named participation history and preserves filters on tab navigation and history restoration", async () => {
  const base = `/users/${userId}`;
  history.replaceState(null, "", `/portal/#${base}/meetings?users.q=synthetic`);
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<UserParticipationHistory userId={userId} canRead />, host!));
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Meetings");
  expect(host.querySelector("[data-endpoint]")?.getAttribute("data-endpoint")).toContain("/meetings");
  const events = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => tab.textContent === "Events",
  )!;
  await act(() => events.click());
  expect(location.hash).toBe(`#${base}?users.q=synthetic`);
  await act(() => {
    history.replaceState(null, "", `/portal/#${base}/meetings?users.q=synthetic`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Meetings");
});
