// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sponsorshipEventsListResponseSchema } from "../../assets/shared/schemas/sponsorship-management";
import { Badge, statusTone, statusLabel } from "../../assets/ts/components/Badge";
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
    expect(statusTone("approved")).toBe("ok");
    expect(statusTone("ec_review")).toBe("warn");
    expect(statusTone("closed")).toBe("neutral");
    expect(statusTone("something_unknown")).toBe("neutral");
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

  it("states a response that failed its contract without printing the contract", () => {
    // Every list validates its response through the shared collection
    // controller, so a schema refusal is a thing readers can actually meet.
    // Its own message is the issue list as JSON, which is for the log.
    const refusal = sponsorshipEventsListResponseSchema.safeParse({ events: [{}], page: null });
    const container = mount(<ErrorAlert error={refusal.error} />);
    expect(container.textContent).toContain("could not read");
    expect(container.textContent).not.toContain("invalid_value");
    expect(container.textContent).not.toContain("Invalid option");
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

/**
 * A validator's working is not a message to a reader.
 *
 * Issue #13: the members page rendered several hundred lines of
 * `{"expected":"string","code":"invalid_type","path":["members",0,"slug"]…}`
 * in a red band across the whole site. That is a `ZodError`'s `message` — its
 * issue list as JSON — reaching the screen because the surface had caught the
 * error and kept only its text, so `ErrorAlert`'s `instanceof` check never
 * saw it.
 */
describe("a response the page could not read", () => {
  const MALFORMED =
    "The server sent a response this page could not read. Try again, and let us know if it keeps happening.";

  it("is described in words, whether the failure arrives as an error or as its text", () => {
    const issues = JSON.stringify([
      { expected: "string", code: "invalid_type", path: ["members", 0, "slug"], message: "Invalid input" },
      { expected: "string", code: "invalid_type", path: ["members", 0, "tier"], message: "Invalid input" },
    ]);
    expect(friendlyErrorMessage(issues)).toBe(MALFORMED);
    // The union form the nullable logo field produces, too.
    expect(friendlyErrorMessage('[{"code":"invalid_union","errors":[[]],"path":["members",0,"logoUrl"]}]')).toBe(
      MALFORMED,
    );
  });

  it("leaves an ordinary message alone", () => {
    // The guard keys on the shape of a serialized issue list, so a sentence
    // that merely mentions a path or a code is still shown as written.
    expect(friendlyErrorMessage("Could not save the invalid_type field.")).toBe(
      "Could not save the invalid_type field.",
    );
    expect(friendlyErrorMessage("Nothing matched that search.")).toBe("Nothing matched that search.");
  });
});
