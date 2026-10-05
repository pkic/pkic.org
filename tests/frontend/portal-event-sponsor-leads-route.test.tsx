// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { sponsorLeadListSchema, sponsorLeadSponsorsSchema } from "../../assets/shared/schemas/event-sponsor-lead-list";
import { EventWorkspace } from "../../assets/ts/member-flows/portal/sections/events/EventWorkspace";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/events/event-one/leads", navigate] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const eventPath = "/api/v1/events/event-one";
const discoveryPath = `${eventPath}/sponsors/leads`;
const sponsorId = "10000000-0000-4000-8000-000000000004";
const contactsPath = `${eventPath}/sponsors/${sponsorId}/leads`;
const page = { limit: 50, offset: 0, total: 1, hasMore: false };
let host: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function mount(access: boolean, canView = true, canExport = false, refused = false): Promise<string[]> {
  const requests: string[] = [];
  const event = eventDetailResponseSchema.parse({
    event: {
      id: "10000000-0000-4000-8000-000000000001",
      slug: "event-one",
      name: "Sponsor-scoped event",
      timezone: "UTC",
      startsAt: "2030-01-01T10:00:00.000Z",
      endsAt: "2030-01-01T17:00:00.000Z",
      profileKey: null,
      registrationPolicy: "public",
      visibility: "invitation_only",
      accessLevel: "participant",
      location: null,
      links: [],
      basePath: null,
      viewer: null,
      sponsorLeadAccess: access,
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      requests.push(path);
      if (path === eventPath) return json(event);
      expect(init?.cache).toBe("no-store");
      if (path === discoveryPath) {
        if (refused)
          return json({ error: { code: "FORBIDDEN", message: "Sponsor access is no longer available." } }, 403);
        return json(
          sponsorLeadSponsorsSchema.parse({
            sponsors: [{ id: sponsorId, name: "Authorized sponsor", canView, canExport, canCapture: false }],
            page,
          }),
        );
      }
      if (path === contactsPath)
        return json(
          sponsorLeadListSchema.parse({
            leads: [
              {
                id: sponsorId,
                userId: sponsorId,
                name: "Consenting attendee",
                email: "attendee@example.test",
                organization: null,
                capturedAt: "2030-01-01T10:00:00.000Z",
                operatorUserId: sponsorId,
                operatorName: "Operator",
              },
            ],
            page,
          }),
        );
      throw new Error(`Unexpected route: ${path}`);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() => {
    render(<EventWorkspace view="detail" slug="event-one" tab="leads" />, host!);
  });
  return requests;
}

afterEach(async () => {
  const mountedHost = host;
  if (mountedHost)
    await act(() => {
      render(null, mountedHost);
    });
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("sponsor-only event contacts route", () => {
  it.each([
    [true, false],
    [false, true],
  ])("opens permitted view/export scope without the owning group workspace", async (canView, canExport) => {
    const requests = await mount(true, canView, canExport);
    const open = await vi.waitFor(() => {
      const button = host!.querySelector<HTMLButtonElement>('button[aria-label="Open leads for Authorized sponsor"]');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(host!.querySelector("h2")?.textContent).toBe("Sponsor-scoped event");
    await act(() => {
      open.click();
    });
    if (canView) {
      await vi.waitFor(() => expect(host!.textContent).toContain("Consenting attendee"));
      expect(requests).toContain(contactsPath);
    } else {
      expect(requests).not.toContain(contactsPath);
      expect(host!.textContent).not.toContain("attendee@example.test");
    }
    await act(() => {
      host!.querySelector<HTMLButtonElement>('button[aria-label="Sponsor actions"]')!.click();
    });
    expect(Boolean(host!.querySelector('a[href$="/leads.csv"]'))).toBe(canExport);
    expect(requests).toContain(eventPath);
    expect(requests).toContain(discoveryPath);
    expect(requests.some((path) => path.includes("/groups/"))).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuses capture-only access before requesting contact discovery", async () => {
    const requests = await mount(false);
    await vi.waitFor(() => expect(host!.querySelector('[role="alert"]')?.textContent).toContain("view or export"));
    expect(requests).toEqual([eventPath]);
    expect(host!.querySelector("table")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps live API refusal authoritative after an earlier eligible event read", async () => {
    const requests = await mount(true, true, false, true);
    await vi.waitFor(() => expect(host!.textContent).toContain("Sponsor access is no longer available"));
    expect(requests).toContain(discoveryPath);
    expect(requests).not.toContain(contactsPath);
    expect(host!.textContent).not.toContain("Consenting attendee");
    expect(navigate).not.toHaveBeenCalled();
  });
});
