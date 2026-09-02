// @vitest-environment jsdom
/**
 * The event registrations list.
 *
 * This surface carried more signal in colour than any other in the portal: a
 * green tick with a `title` for sponsor consent, four tinted numbers in the
 * stats strip, and a `<span>` wearing button classes in the last column. Two
 * of its four filters had no accessible name at all. What is asserted here is
 * what a visual review cannot see — that each of those now says what it means
 * in words, that every filter is named, that the row's activation is a real
 * control, and that a failed list is announced rather than left blank.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eventRegistrationsListResponseSchema,
  type EventRegistrationSummary,
} from "../../assets/shared/schemas/event-registrations";
import { Registrations } from "../../assets/ts/member-flows/portal/sections/events/detail/Registrations";
import { chooseColumnFilter, columnFilterOptions, columnFilterSummary } from "./helpers/column-menu";
import { tabNames } from "./helpers/tabs";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = "2026-08-31T09:00:00.000Z";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function registration(overrides: Partial<EventRegistrationSummary> = {}): Record<string, unknown> {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    user_id: "50000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    user_email: "ada@example.test",
    display_name: "Ada Lovelace",
    referral_code: null,
    status: "registered",
    attendance_type: "in_person",
    source_type: "direct",
    rsvp_events_json: null,
    has_bounced: false,
    sponsor_consent: true,
    custom_answers_json: null,
    dayWaitlistSummary: null,
    dayWaitlistCount: 0,
    attendanceChangeHistory: [],
    lastAttendanceChange: null,
    ...overrides,
  };
}

/** Parsed through the shared list contract, so a fixture cannot drift from it. */
function listPage(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return eventRegistrationsListResponseSchema.parse({
    registrations: rows,
    page: { limit: 25, offset: 0, total: rows.length, count: rows.length, hasMore: false },
    event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
    stats: {
      byAttendanceType: { in_person: 1 },
      attendanceStatusByType: { in_person: { accepted: 1, waitlisted: 0 } },
      byStatus: { registered: 1, pending_email_confirmation: 2 },
      bouncedCount: 3,
      consentCount: 1,
    },
  }) as unknown as Record<string, unknown>;
}

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every filter control's accessible name, however it was given one. */
function filterNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("select")].map((select) => {
    const labelled = select.id ? root.querySelector(`label[for="${select.id}"]`)?.textContent : null;
    return labelled ?? select.getAttribute("aria-label") ?? "";
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event registrations list", () => {
  it("keeps status, email delivery and consent in their columns, and names the one view control left in the toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    // Three of the four filters narrow by a value a column shows, so they
    // live in those columns' menus. The attendance-change view is the one
    // control left above the table — it reshapes the columns and is reached
    // from the attendance dashboard's links — and it says what it is; it
    // used to announce only "combo box".
    expect(filterNames(page)).toEqual(["Attendance changes"]);
    expect(columnFilterOptions(page, "Status")).toEqual([
      "All statuses",
      "Registered",
      "Pending confirmation",
      "Cancelled",
    ]);
    expect(columnFilterOptions(page, "Email")).toEqual(["All email statuses", "Bounced", "Not bounced"]);
    expect(columnFilterOptions(page, "Consent")).toEqual([
      "All consent",
      "Sponsor consent given",
      "No sponsor consent",
    ]);
  });

  it("sends the status, consent and attendance-change choices to the registrations query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        return json(listPage([]));
      }),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    await chooseColumnFilter(page, "Consent", "Sponsor consent given");
    await settle();
    expect(requests.at(-1)?.searchParams.get("consent")).toBe("true");
    expect(columnFilterSummary(page, "Consent")).toBe("Sponsor consent given");

    await chooseColumnFilter(page, "Status", "Cancelled");
    await settle();
    // Both column filters travel together, from the first page.
    expect(requests.at(-1)?.searchParams.get("status")).toBe("cancelled");
    expect(requests.at(-1)?.searchParams.get("consent")).toBe("true");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    const changes = page.querySelector<HTMLSelectElement>('select[aria-label="Attendance changes"]')!;
    changes.value = "left_in_person";
    await act(async () => {
      changes.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    expect(requests.at(-1)?.searchParams.get("attendance_change")).toBe("left_in_person");
    // The view keeps the column filters that still have a column.
    expect(requests.at(-1)?.searchParams.get("status")).toBe("cancelled");
  });

  it("states email delivery in words in its own column, not as a second badge in the status cell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration({ has_bounced: true })]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    const heads = [...page.querySelectorAll("th")].map((th) => th.textContent!.trim());
    expect(heads.some((head) => head.startsWith("Email"))).toBe(true);
    const cells = [...page.querySelectorAll("tbody td")].map((td) => td.textContent!.trim());
    expect(cells).toContain("Bounced");
  });

  it("names the table and states sponsor consent in words, not only as a green tick", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    // Four unnamed tables on one page are announced as four tables.
    expect(page.querySelector("caption")?.textContent).toBe("Event registrations");
    // The tick is decoration; the sentence beside it is the answer. The
    // consent cell is found by its sentence, since the row's other quiet
    // states — a delivered email — say theirs the same way.
    const hidden = [...page.querySelectorAll("tbody .pk-sr-only")].map((span) => span.textContent);
    expect(hidden).toContain("Consented to share with sponsors");
    expect(page.textContent).toContain("✓");
  });

  it("says why consent is absent rather than showing an unexplained dash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration({ sponsor_consent: false })]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    const hidden = [...page.querySelectorAll(".pk-sr-only")].map((span) => span.textContent);
    expect(hidden).toContain("No sponsor consent");
    // The dash is hidden from assistive technology, so it is not read as text.
    const dashes = [...page.querySelectorAll("[aria-hidden='true']")].map((element) => element.textContent);
    expect(dashes).toContain("—");
  });

  it("makes the row's activation a real control with a name that says whose row it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    // Never an onClick on the `<tr>`: a row is not focusable and takes no
    // Enter key, which is how fourteen portal lists became mouse-only.
    const rowLink = page.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink).not.toBeNull();
    expect(rowLink?.textContent).toBe("View registration for Ada Lovelace");
    expect(page.querySelector("tbody tr")?.getAttribute("onclick")).toBeNull();
  });

  it("keeps the 'View →' column out of the row's announced name, because the row is the link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    const view = [...page.querySelectorAll("[aria-hidden='true']")].find((element) =>
      element.textContent?.includes("View →"),
    );
    expect(view).toBeDefined();
    // And it is not a control: a span wearing button classes is worse than
    // no affordance, because it looks like something to press.
    expect(view?.tagName.toLowerCase()).toBe("span");
  });

  it("states each stat in words, so the strip is not read by tint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    const strip = page.querySelector("[role='group']");
    expect(strip?.getAttribute("aria-label")).toBe("Registration totals");
    expect(strip?.textContent).toContain("1 accepted");
    expect(strip?.textContent).toContain("2 pending");
    expect(strip?.textContent).toContain("3 bounced");
    // Nothing in the strip relies on a colour class to say which is which.
    expect(strip?.querySelector("[class*='text-']")).toBeNull();
  });

  it("announces a failed list as a sentence rather than leaving the table blank", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "unavailable" }, 503)),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();
    await settle();

    const alert = page.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
  });

  it("names the tab set, so it is not one of several anonymous 'Sections' strips", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<Registrations slug="pqc-2026" />);
    await settle();

    expect(page.querySelector("[role='tablist']")?.getAttribute("aria-label")).toBe("Registration sections");
    expect(tabNames(page)).toEqual(["Overview", "Responses", "Email"]);
  });
});
