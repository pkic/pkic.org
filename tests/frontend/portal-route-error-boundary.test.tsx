// @vitest-environment jsdom
import { render, type ComponentChildren, type FunctionComponent } from "preact";
import { act } from "preact/test-utils";
import { lazy, Suspense } from "preact/compat";
import { afterEach, expect, it } from "vitest";
import { PortalRouteErrorBoundary } from "../../assets/ts/member-flows/portal/shell/PortalRouteErrorBoundary";
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  history.replaceState(null, "", "/portal/#/");
});
function Broken(): never {
  throw new Error("Synthetic unsupported client capability");
}
function page(children: ComponentChildren) {
  return (
    <>
      <a href="#/groups">Groups navigation</a>
      <PortalRouteErrorBoundary>{children}</PortalRouteErrorBoundary>
    </>
  );
}
async function mount(children: ComponentChildren) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(page(children), host!));
}
it("keeps navigation after a render failure and recovers on route change", async () => {
  history.replaceState(null, "", "/portal/#/events/conference/scanner");
  await mount(<Broken />);
  expect(host!.textContent).toContain("Synthetic unsupported client capability");
  expect(host!.querySelector("a")?.textContent).toBe("Groups navigation");
  await act(() => {
    history.replaceState(null, "", "/portal/#/groups");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    render(page(<p>Working groups</p>), host!);
  });
  expect(host!.textContent).toContain("Working groups");
  expect(host!.textContent).not.toContain("Synthetic unsupported client capability");
});
it("contains a rejected lazy import inside the view", async () => {
  const Failed = lazy<FunctionComponent>(() => Promise.reject(new Error("Synthetic unavailable module")));
  await mount(
    <Suspense fallback={<p>Loading view</p>}>
      <Failed />
    </Suspense>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host!.textContent).toContain("Synthetic unavailable module");
  expect(host!.querySelector("a")).not.toBeNull();
});

it("explains the native secure-context refusal while retaining navigation", async () => {
  function Unsupported(): never {
    throw new TypeError("crypto.randomUUID is not a function");
  }
  await mount(<Unsupported />);
  expect(host!.textContent).toContain("secure connection");
  expect(host!.textContent).toContain("HTTPS");
  expect(host!.textContent).toContain("localhost");
  expect(host!.querySelector("a")).not.toBeNull();
});

it("preserves a healthy collection and its dialog opener across child-route navigation", async () => {
  history.replaceState(null, "", "/portal/#/settings/membership-categories");
  await mount(<button>Category actions</button>);
  const opener = host!.querySelector("button")!;
  opener.focus();
  await act(() => {
    history.replaceState(null, "", "/portal/#/settings/membership-categories/F");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    render(page(<button>Category actions</button>), host!);
  });
  expect(host!.querySelector("button")).toBe(opener);
  expect(document.activeElement).toBe(opener);
});

it("offers page reload for an unavailable lazy module while retaining navigation", async () => {
  function MissingModule(): never {
    throw new TypeError("Failed to fetch dynamically imported module: /_assets/old.js");
  }
  await mount(<MissingModule />);
  expect(host!.querySelector("button")?.textContent).toContain("Reload page");
  expect(host!.textContent).not.toContain("/_assets/old.js");
  expect(host!.querySelector("a")).not.toBeNull();
});
