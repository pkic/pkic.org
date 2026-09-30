// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Proposals } from "../../assets/ts/member-flows/portal/sections/events/detail/Proposals";
import { chooseColumnFilter, columnFilterOptions } from "./helpers/column-menu";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const SPEAKER_ID = "10000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "20000000-0000-4000-8000-000000000001";
let container: HTMLElement | null = null;

async function mount(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<Proposals slug="spring-summit" subTab="speakers" canWrite={false} />, container!);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("proposal speakers tab", () => {
  it("shows a speaker's talk and registration and filters the server list", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            speakers: [
              {
                id: SPEAKER_ID,
                userId: "30000000-0000-4000-8000-000000000001",
                proposalId: PROPOSAL_ID,
                proposalTitle: "Organization security case study",
                proposalStatus: "accepted",
                firstName: "Alex",
                lastName: "Example",
                organizationName: "Example Organization",
                status: "confirmed",
                registrationId: null,
                registrationStatus: null,
                attendanceType: null,
                days: [],
              },
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const page = await mount();
    expect(page.querySelector('nav[aria-label="Proposal sections"] a[aria-current="page"]')?.textContent).toBe(
      "Speakers",
    );
    expect(page.querySelector("caption")?.textContent).toBe("Proposal speakers");
    expect(page.querySelector("tbody")?.textContent).toContain("Alex Example");
    expect(page.querySelector("tbody")?.textContent).toContain("Organization security case study");
    expect(page.querySelector("tbody")?.textContent).toContain("Not registered");
    expect(page.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link")?.href).toContain(
      `/proposals/detail/${PROPOSAL_ID}`,
    );
    expect(columnFilterOptions(page, "Registration")).toEqual([
      "All registration statuses",
      "Needs registration",
      "Registered",
    ]);
    await chooseColumnFilter(page, "Registration", "Needs registration");
    const requested = fetchMock.mock.calls.map((call) => new URL(String(call[0]), location.origin));
    expect(requested.at(-1)?.searchParams.get("registration")).toBe("missing");
  });
});
