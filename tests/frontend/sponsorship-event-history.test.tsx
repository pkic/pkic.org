// @vitest-environment jsdom
/**
 * The sponsorship record page: its pipeline history, and the forms beside it.
 *
 * The history was an ordered list behind a hook of its own, with a "Load older
 * history" button and no way to search or re-order it — though the endpoint
 * has taken `q` and `sort=createdAt` since it was written (#42). It is the
 * shared table now, so what is asserted here is the query string it sends,
 * and that a failure in the trail leaves the record itself readable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { sponsorshipEventsListResponseSchema } from "../../assets/shared/schemas/sponsorship-management";
import { SponsorshipDetail } from "../../assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipDetail";
import { buttonNamed, controlFor, groupNames, namedGroup, typeInto } from "./helpers/labelled-control";

const SPONSORSHIP_ID = "000000000000000000000000000000aa";

function event(id: string, toStage: "new_inquiry" | "active", note: string | null = null) {
  return {
    id,
    fromStage: toStage === "active" ? ("new_inquiry" as const) : null,
    toStage,
    actorUserId: null,
    actorName: null,
    note,
    createdAt: "2026-08-21T12:00:00.000Z",
  };
}

/** One history page, parsed through the shared contract so a drift in it fails here. */
function historyResponse(events: ReturnType<typeof event>[], total = events.length, offset = 0, limit = 50) {
  return Response.json(
    sponsorshipEventsListResponseSchema.parse({
      events,
      page: { limit, offset, total, hasMore: offset + events.length < total },
    }),
  );
}

function tiersResponse() {
  return Response.json({
    visibility: "public",
    sponsorType: "consortium",
    tiers: [{ tier: "Gold" }, { tier: "Silver" }],
  });
}

function sponsorshipResponse(id: string) {
  return Response.json({
    sponsorship: {
      id,
      sponsorType: "consortium",
      organizationId: null,
      organizationName: "Acme Sponsor",
      nonMemberName: null,
      nonMemberWebsite: null,
      nonMemberLogoUrl: null,
      contactName: null,
      contactEmail: null,
      eventId: null,
      eventName: null,
      tier: "Gold",
      pipelineStage: "active",
      startDate: null,
      renewalDate: null,
      assignedToUserId: null,
      assignedToName: null,
      notes: null,
      priceAmountCents: null,
      priceCurrency: null,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const mounted: HTMLElement[] = [];

async function detail(id = SPONSORSHIP_ID): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => render(h(SponsorshipDetail, { id, canWrite: true, onChanged: vi.fn() }), container));
  // Two ticks: the record resolves first, and only then does the history
  // table mount and ask for its own page.
  await act(flush);
  await act(flush);
  return container;
}

/** The history table's own panel, which names itself after the list it holds. */
function historyPanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('section[aria-label="Pipeline history"]');
  if (!panel) throw new Error("the pipeline history table was not rendered");
  return panel;
}

function isHistoryRequest(input: RequestInfo | URL): boolean {
  return String(input).split("?", 1)[0].endsWith("/events");
}

describe("sponsorship pipeline history", () => {
  afterEach(() => {
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.location.hash = "";
  });

  it("asks D1 for the newest page of the trail, bounded and ordered", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "https://app.test");
        requested.push(url);
        return isHistoryRequest(input)
          ? historyResponse([event("1".padStart(32, "0"), "active")])
          : sponsorshipResponse(SPONSORSHIP_ID);
      }),
    );
    await detail();

    const history = requested.find((url) => url.pathname.endsWith("/events"));
    expect(history?.pathname).toBe(`/api/v1/sponsors/${SPONSORSHIP_ID}/events`);
    // Newest first, one bounded page: the browser is handed a page, not the
    // whole trail to order itself.
    expect(history?.searchParams.get("sort")).toBe("-createdAt");
    expect(history?.searchParams.get("limit")).toBe("50");
    expect(history?.searchParams.get("offset")).toBe("0");
  });

  it("searches and re-orders the trail through the query string", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(new URL(String(input), "https://app.test"));
        return isHistoryRequest(input)
          ? historyResponse([event("1".padStart(32, "0"), "active")])
          : sponsorshipResponse(SPONSORSHIP_ID);
      }),
    );
    const container = await detail();
    const panel = historyPanel(container);

    const search = panel.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    search!.value = "signature";
    await act(async () => {
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });
    await act(async () => {
      search!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flush();
    });
    expect(requested.map((url) => url.searchParams.get("q"))).toContain("signature");

    const when = [...panel.querySelectorAll<HTMLButtonElement>("th button")].find((button) =>
      button.textContent?.includes("When"),
    );
    expect(when).toBeDefined();
    await act(async () => {
      when!.click();
      await flush();
    });
    expect(requested.map((url) => url.searchParams.get("sort"))).toContain("createdAt");
  });

  it("renders each transition as a row with a machine-readable timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        isHistoryRequest(input)
          ? historyResponse([event("2".padStart(32, "0"), "active", "Signed")])
          : sponsorshipResponse(SPONSORSHIP_ID),
      ),
    );
    const container = await detail();
    const panel = historyPanel(container);

    expect(panel.querySelector("caption")?.textContent).toBe("Pipeline history");
    expect(panel.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(panel.querySelector("time")?.getAttribute("datetime")).toBe("2026-08-21T12:00:00.000Z");
    // The transition reads as one phrase in one cell, which is what the
    // end-to-end flow looks for after moving a stage.
    expect(panel.textContent).toContain("New inquiry → Active");
    expect(panel.textContent).toContain("Signed");
  });

  it("runtime-validates the trail and states a failure without hiding the record", async () => {
    let historyRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!isHistoryRequest(input)) return sponsorshipResponse(SPONSORSHIP_ID);
        historyRequests += 1;
        return historyRequests === 1
          ? Response.json({
              events: [{ ...event("1".padStart(32, "0"), "active"), toStage: "invented" }],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            })
          : historyResponse([]);
      }),
    );
    const container = await detail();

    // The record is still readable, and the refusal is a sentence rather than
    // a schema message about an invalid option.
    expect(container.textContent).toContain("Acme Sponsor");
    const alert = historyPanel(container).querySelector("[role='alert']");
    expect(alert?.textContent).toContain("could not read");
    expect(alert?.textContent).not.toContain("Invalid option");

    // The list's own Refresh asks again — the trail is retried where it
    // failed, without reloading the record beside it.
    const refresh = [...historyPanel(container).querySelectorAll("button")].find(
      (button) => button.textContent === "Refresh",
    );
    await act(async () => {
      refresh!.click();
      await flush();
    });
    await act(flush);
    expect(historyRequests).toBe(2);
    expect(historyPanel(container).querySelector("[role='alert']")).toBeNull();
    expect(historyPanel(container).querySelector("[role='status']")?.textContent).toContain(
      "No pipeline history has been recorded.",
    );
  });

  it("asks the trail for itself again once a stage move has written to it", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requested.push(`${init?.method ?? "GET"} ${url.split("?", 1)[0]}`);
        if (isHistoryRequest(input)) return historyResponse([]);
        if (url.endsWith("/stage")) return sponsorshipResponse(SPONSORSHIP_ID);
        return sponsorshipResponse(SPONSORSHIP_ID);
      }),
    );
    const container = await detail();
    const before = requested.filter((request) => request.endsWith("/events")).length;

    await act(async () => {
      buttonNamed(container, "Move stage").click();
      await flush();
    });
    await act(async () => {
      buttonNamed(container, "Move").click();
      await flush();
    });
    await act(flush);

    expect(requested.filter((request) => request.endsWith("/events")).length).toBeGreaterThan(before);
  });
});

describe("sponsorship record forms", () => {
  afterEach(() => {
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.location.hash = "";
  });

  it("names the sponsorship region and wires every editable field to its own label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input).split("?", 1)[0];
        if (path.endsWith("/events")) return historyResponse([]);
        if (path.endsWith("/sponsors/tiers")) return tiersResponse();
        return sponsorshipResponse(SPONSORSHIP_ID);
      }),
    );
    const container = await detail();

    // The surface is addressable by name rather than by its container's
    // class, which is what the end-to-end spec now relies on.
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Acme Sponsor");

    // Both forms are closed until asked for: a reader who opened the record
    // to look at it is shown its facts, not three forms.
    expect(container.querySelector("form")).toBeNull();
    await act(async () => {
      buttonNamed(container, "Edit").click();
      buttonNamed(container, "Move stage").click();
      await flush();
    });
    // The tier catalog is fetched by the edit form once it mounts, so its
    // options land a tick after the form does.
    await act(flush);
    /*
     * Everything staff can correct about the record, each on its own label.
     * The tier is a Select over the catalog rather than a text box, because a
     * tier is a row with a price beside it — that was the substance of issue
     * #30 along with the contact, which used to be readable and not editable.
     */
    for (const [label, tag] of [
      ["Sponsor name", "INPUT"],
      ["Website", "INPUT"],
      ["Tier", "SELECT"],
      ["Renewal date", "INPUT"],
      ["Contact name", "INPUT"],
      ["Contact email", "INPUT"],
      ["Notes", "TEXTAREA"],
      ["Move to stage", "SELECT"],
      ["Note (optional)", "INPUT"],
    ] as const) {
      expect(controlFor(container, label).tagName).toBe(tag);
    }
    // The catalog, plus the empty choice for a sponsorship with no tier yet.
    expect([...controlFor(container, "Tier").querySelectorAll("option")].map((option) => option.value)).toEqual([
      "",
      "Gold",
      "Silver",
    ]);
    // A terminal stage for a company that decides against sponsoring, which
    // is what staff previously had no word for.
    expect([...controlFor(container, "Move to stage").querySelectorAll("option")].map((o) => o.value)).toContain(
      "not_proceeding",
    );
    // Assignment is a search-as-you-type picker over real users — the record
    // stores a user id, but nobody types a UUID. The picker lives in its own
    // named group and carries the shared control's accessible name.
    const assignedGroup = namedGroup(container, "Assigned staff");
    expect(assignedGroup.querySelector('input[aria-label="Search for a user"]')).not.toBeNull();
    // Each form is named for what it does, so the repeated note fields are
    // announced inside the form they belong to.
    expect(groupNames(container)).toEqual(["Assigned staff"]);
    expect([...container.querySelectorAll("form")].map((form) => form.getAttribute("aria-label"))).toEqual([
      "Edit sponsorship record",
      "Move pipeline stage",
    ]);
  });

  it("reports a failed stage move without losing the note the reader typed", async () => {
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isHistoryRequest(input)) return historyResponse([]);
        if (url.endsWith("/stage")) {
          return Response.json({ error: { code: "STAGE_REJECTED", message: "Stage change refused" } }, { status: 409 });
        }
        return sponsorshipResponse(SPONSORSHIP_ID);
      }),
    );
    const container = await detail();

    await act(async () => {
      buttonNamed(container, "Move stage").click();
      await flush();
    });
    await typeInto(controlFor(container, "Note (optional)"), "Waiting on signature");

    const advance = buttonNamed(container, "Move");
    await act(async () => {
      advance.click();
      await flush();
    });

    expect(toastArea.textContent).toContain("Stage change refused");
    expect(controlFor(container, "Note (optional)").value).toBe("Waiting on signature");
    expect(advance.getAttribute("aria-busy")).toBeNull();
  });
});
