// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { AgendaWorkspaceHeader } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaWorkspaceHeader";
import { AgendaDayNavigation } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaDayNavigation";
import { useAgendaWorkspaceRoute } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAgendaWorkspaceRoute";

const days = [{ date: "2026-12-01" }, { date: "2026-12-02" }];
const host = document.createElement("div");
function Workspace() {
  const state = useAgendaWorkspaceRoute(days);
  return (
    <>
      <AgendaWorkspaceHeader view={state.view} onViewChange={state.setView} actions={null} />
      <AgendaDayNavigation days={days} activeDate={state.day} onSelect={state.setDay} />
    </>
  );
}
const mount = async () => {
  document.body.append(host);
  await act(() => render(<Workspace />, host));
};
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  history.replaceState(null, "", "/");
});

it("restores the actual organizer wrapper's selected date and workspace view from natural routes", async () => {
  history.replaceState(null, "", "/portal/#/groups/group/events/event/agenda/2026-12-02?agendaSources=open");
  await mount();
  expect(host.querySelector("#agenda-workspace-tab-agenda")?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector("#agenda-tab-2026-12-02")?.getAttribute("aria-selected")).toBe("true");
  await act(() => host.querySelector<HTMLButtonElement>("#agenda-workspace-tab-sessions")!.click());
  expect(location.hash).toBe("#/groups/group/events/event/agenda/sessions?agendaSources=open&agendaDay=2026-12-02");
  expect(host.querySelector("#agenda-workspace-tab-sessions")?.getAttribute("aria-selected")).toBe("true");
  await act(() => render(null, host));
  await mount();
  expect(host.querySelector("#agenda-workspace-tab-sessions")?.getAttribute("aria-selected")).toBe("true");
  await act(() => host.querySelector<HTMLButtonElement>("#agenda-workspace-tab-agenda")!.click());
  expect(location.hash).toBe("#/groups/group/events/event/agenda/2026-12-02?agendaSources=open");
  expect(host.querySelector("#agenda-tab-2026-12-02")?.getAttribute("aria-selected")).toBe("true");
});

it("updates day tabs through the canonical route and restores browser-history changes without retaining local state", async () => {
  history.replaceState(null, "", "/portal/#/groups/group/events/event/agenda/2026-12-01");
  await mount();
  await act(() => host.querySelector<HTMLButtonElement>("#agenda-tab-2026-12-02")!.click());
  expect(location.hash).toBe("#/groups/group/events/event/agenda/2026-12-02");
  await act(() => {
    history.replaceState(null, "", "/portal/#/groups/group/events/event/agenda/staffing?agendaDay=2026-12-01");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(host.querySelector("#agenda-workspace-tab-staffing")?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector("#agenda-tab-2026-12-01")?.getAttribute("aria-selected")).toBe("true");
});
