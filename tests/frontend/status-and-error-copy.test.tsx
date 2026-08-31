// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, statusColor, statusLabel } from "../../assets/ts/components/Badge";
import { ErrorAlert, friendlyErrorMessage } from "../../assets/ts/components/ErrorAlert";
import { useHashQueryParam } from "../../assets/ts/hooks/useHashQueryParam";
import { usePortalHashLocation } from "../../assets/ts/member-flows/portal/hash-location";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/", () => undefined],
}));

const mounted: HTMLElement[] = [];

function mount(node: preact.ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  history.replaceState(null, "", "/portal/#/x");
});

describe("canonical status registry", () => {
  it("labels machine statuses as sentences", () => {
    expect(statusLabel("ec_review")).toBe("EC review");
    expect(statusLabel("pending_review")).toBe("Pending review");
    expect(statusLabel("under_review")).toBe("Under review");
    expect(statusLabel("scheduled")).toBe("Scheduled");
  });

  it("colors every registered status and falls back to neutral", () => {
    expect(statusColor("approved")).toBe("success");
    expect(statusColor("ec_review")).toBe("warning");
    expect(statusColor("closed")).toBe("secondary");
    expect(statusColor("something_unknown")).toBe("secondary");
  });

  it("renders the label through Badge", () => {
    const container = mount(<Badge status="ec_review" />);
    expect(container.textContent).toBe("EC review");
  });
});

describe("error copy", () => {
  it("turns transport phrasing into sentences", () => {
    expect(friendlyErrorMessage("HTTP 403")).toContain("don't have access");
    expect(friendlyErrorMessage("HTTP 409")).toContain("Reload");
    expect(friendlyErrorMessage("HTTP 500: boom")).toContain("our side");
  });

  it("keeps already-human messages untouched", () => {
    expect(friendlyErrorMessage("Only SVG logos are accepted.")).toBe("Only SVG logos are accepted.");
  });

  it("renders the mapped copy in the alert", () => {
    const container = mount(<ErrorAlert error="HTTP 403" />);
    expect(container.textContent).toContain("don't have access");
  });
});

describe("portal location hook", () => {
  it("formats link hrefs into the hash so open-in-new-tab works", () => {
    expect(usePortalHashLocation.hrefs("/groups/abc")).toBe("#/groups/abc");
  });
});

describe("useHashQueryParam", () => {
  function Probe() {
    const [tab, setTab] = useHashQueryParam("probeTab", "first");
    return (
      <button type="button" onClick={() => setTab("second")}>
        {tab}
      </button>
    );
  }

  it("initializes from the hash query and mirrors changes back", async () => {
    history.replaceState(null, "", "/portal/#/x?probeTab=second");
    const container = mount(<Probe />);
    expect(container.querySelector("button")?.textContent).toBe("second");

    history.replaceState(null, "", "/portal/#/x");
    const fresh = mount(<Probe />);
    expect(fresh.querySelector("button")?.textContent).toBe("first");
    await act(() => fresh.querySelector("button")!.click());
    expect(window.location.hash).toBe("#/x?probeTab=second");
  });

  it("removes only its own key on unmount", async () => {
    history.replaceState(null, "", "/portal/#/x?other=keep&probeTab=second");
    const container = mount(<Probe />);
    await act(() => render(null, container));
    expect(window.location.hash).toBe("#/x?other=keep");
  });
});
