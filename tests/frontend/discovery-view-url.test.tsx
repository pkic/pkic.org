// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { useDiscoveryView } from "../../assets/ts/member-flows/portal/sections/DiscoveryView";
let container: HTMLElement;
function View() {
  const { view, setView } = useDiscoveryView();
  return <button onClick={() => setView(view === "list" ? "grid" : "list")}>{view}</button>;
}
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  history.replaceState(null, "", "/");
});
it("restores a bookmarked list, omits grid default, follows history and keeps URL on unmount", async () => {
  history.replaceState(null, "", "/portal/#/events?view=list&q=conference");
  container = document.createElement("div");
  document.body.append(container);
  await act(() => render(<View />, container));
  expect(container.textContent).toBe("list");
  await act(() => container.querySelector("button")!.click());
  expect(location.hash).toBe("#/events?q=conference");
  await act(() => {
    history.replaceState(null, "", "/portal/#/events?view=list&q=conference");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(container.textContent).toBe("list");
  await act(() => render(null, container));
  expect(location.hash).toBe("#/events?view=list&q=conference");
});
